require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();

const corsOptions = {
    origin: process.env.FRONTEND_URL, 
    optionsSuccessStatus: 200 
};

app.use(express.json());
app.use(cors(corsOptions));

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGO_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await client.connect();
    
    const db = client.db('wisdr-server');
    const userDB = client.db('wisdr-users');
    const userCollection = userDB.collection('user');
    const lessonCollections = db.collection('lessons');
    const commentCollections = db.collection('comments');
    const reportCollections = db.collection('reports');
    
    // --- LESSON WRITING ROUTES ---
    app.post('/dashboard/add-lesson', async(req, res) => {
        const data = req.body;
        const result = await lessonCollections.insertOne(data);
        res.send(result);
    });

    app.get('/dashboard/my-lessons', async (req, res) => {
        try {
          const { email } = req.query;
          let query = {};
          
          if (email) {
            query = { creatorEmail: { $regex: `^${email.trim()}$`, $options: 'i' } }; 
          }

          console.log("Incoming Email Param:", email);
          console.log("Constructed MongoDB Query:", query);
          
          const lessons = await lessonCollections.find(query).toArray();
          
          console.log(`Successfully found ${lessons.length} documents.`);
          res.json(lessons); 
        } catch (error) {
          console.error("Backend crash details:", error);
          res.status(500).json({ message: "Server parsing error", error: error.message });
        }
    });

    app.get('/public', async (req, res) => {
        try {
          const limitOnePage = 9;
          
          // Parse values sent out by parameters
          const page = parseInt(req.query.page) || 1;
          const search = req.query.search || "";
          const category = req.query.category || "";
          const emotionalTone = req.query.emotionalTone || "";
          const sort = req.query.sort || "newest";

          // Assembling dynamic query filtering objects
          let queryObject = {};

          if (search) {
            queryObject.$or = [
              { title: { $regex: search, $options: "i" } },
              { description: { $regex: search, $options: "i" } }
            ];
          }

          if (category) {
            queryObject.category = category;
          }

          if (emotionalTone) {
            queryObject.emotionalTone = emotionalTone;
          }

          // Setting up Sort execution configuration rules
          let sortObject = {};
          if (sort === "most-saved") {
            sortObject.savedCount = -1; 
          } else {
            sortObject.createdDate = -1; 
          }

          const skipAmount = (page - 1) * limitOnePage;

          // Execute queries concurrently using Promise.all to optimize execution speed
          const [cursor, totalDoc] = await Promise.all([
            lessonCollections
              .find(queryObject)
              .sort(sortObject)
              .skip(skipAmount)
              .limit(limitOnePage)
              .toArray(),
            lessonCollections.countDocuments(queryObject) 
          ]);

          res.send({ cursor, totalDoc });
        } catch (error) {
          console.error("Backend filter database error:", error);
          res.status(500).send({ message: "Error compiling filtered datasets", error });
        }
    });
        
    app.get('/public/:id', async (req, res) => {
        try {
          const id = req.params.id;
          const lesson = await lessonCollections.findOne({ _id: new ObjectId(id) });
          if (!lesson) return res.status(404).json({ message: "Lesson document not found" });
          res.send(lesson);
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
    });

    // Toggle Like Implementation Endpoint Handler
    app.post('/public/:id/like', async (req, res) => {
        try {
          const { id } = req.params;
          const { email } = req.body; 

          const lesson = await lessonCollections.findOne({ _id: new ObjectId(id) });
          if (!lesson) return res.status(404).json({ message: "Lesson structural data missing" });

          const likesArray = lesson.likes || [];
          const hasLiked = likesArray.includes(email);

          let updateOperation;
          if (hasLiked) {
            updateOperation = {
              $pull: { likes: email },
              $inc: { likesCount: -1 }
            };
          } else {
            updateOperation = {
              $addToSet: { likes: email },
              $inc: { likesCount: 1 }
            };
          }

          await lessonCollections.updateOne({ _id: new ObjectId(id) }, updateOperation);
          res.status(200).json({ success: true });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
    });

    // Toggle Favorites Save Functionality Route Handler
    app.post('/public/:id/save', async (req, res) => {
        try {
          const { id } = req.params;
          const { email } = req.body;

          const lesson = await lessonCollections.findOne({ _id: new ObjectId(id) });
          const favoritesArray = lesson.favorites || [];

          const isSaved = favoritesArray.includes(email);
          const op = isSaved ? { $pull: { favorites: email } } : { $addToSet: { favorites: email } };

          await lessonCollections.updateOne({ _id: new ObjectId(id) }, op);
          res.status(200).json({ success: true });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
    });

    // Fetch Comments Feed Array
    app.get('/public/:id/comments', async (req, res) => {
        try {
          const { id } = req.params;
          const comments = await commentCollections.find({ lessonId: id }).sort({ createdDate: -1 }).toArray();
          res.json(comments);
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
    });

    // Add New Comment Action Route Handler
    app.post('/public/:id/comments', async (req, res) => {
        try {
          const payload = {
            ...req.body,
            lessonId: req.params.id,
            createdDate: new Date(req.body.createdDate)
          };
          const result = await commentCollections.insertOne(payload);
          const savedComment = await commentCollections.findOne({ _id: result.insertedId });
          res.status(201).json(savedComment);
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
    });

    // Create Entry in content Flag Reports Collection Route Handler
    app.post("/reports", async (req, res) => {
      try {
        const payload = {
          ...req.body,
          timestamp: new Date(req.body.timestamp),
        };

        await reportCollections.insertOne(payload);
        res.status(201).json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // --- ADMIN PROFILE AND ROLES ---
    app.get("/dashboard/admin/profile", async (req, res) => {
      const { email } = req.query;
      const admin = await userCollection.findOne({ email });

      if (!admin) {
        return res.status(404).json({ message: "Admin not found" });
      }
      res.json(admin);
    });

    // Subscription Successful
    app.patch("/pricing/success", async (req, res) => {
      try {
        const { email } = req.body;
        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        if (user.role === "admin") {
          return res.json({
            success: true,
            role: "admin",
            message: "Admin role unchanged.",
          });
        }

        await userCollection.updateOne(
          { email },
          { $set: { role: "pro" } }
        );

        res.json({
          success: true,
          role: "pro",
          message: "Subscription activated.",
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Total Users & Dashboard Overview Statistics Metrics
    app.get("/dashboard/admin", async (req, res) => {
        const today = new Date().toISOString().split("T")[0];

        const userCount = await userCollection.countDocuments();
        const publicLessonCount = await lessonCollections.countDocuments();
        const reportCount = await reportCollections.countDocuments();

        const todayNewLessons = await lessonCollections
          .find({ createdDate: { $regex: `^${today}` } })
          .toArray();

        const contributors = await lessonCollections
          .aggregate([
            {
              $group: {
                _id: "$creatorEmail",
                totalLessons: { $sum: 1 },
                creatorName: { $first: "$creatorName" },
                creatorImage: { $first: "$creatorImage" },
              },
            },
            {
              $project: {
                _id: 0,
                creatorEmail: "$_id",
                creatorName: 1,
                creatorImage: 1,
                totalLessons: 1,
              },
            },
            { $sort: { totalLessons: -1 } },
            { $limit: 5 },
          ])
          .toArray();

        const adminHome = {
          userCount,
          publicLessonCount,
          reportCount,
          todayNewLessons,
          contributors,
        };

        res.json(adminHome);
    });

    // Get all users with total lessons
    app.get("/dashboard/admin/manage-users", async (req, res) => {
      const users = await userCollection.find().toArray();

      const usersWithLessons = await Promise.all(
        users.map(async (user) => {
          const totalLessons = await lessonCollections.countDocuments({
            creatorEmail: user.email,
          });

          return {
            ...user,
            totalLessons,
          };
        })
      );

      res.json(usersWithLessons);
    });

    // Update user role
    app.patch("/dashboard/admin/manage-users/:id", async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;

        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );

        res.json(result);
    });
        
    // Manage lessons by admin 
    app.get("/dashboard/admin/manage-lessons", async (req, res) => {
        const { category, visibility } = req.query;
        const query = {};

        if (category) {
          query.category = category;
        }

        if (visibility) {
          query.visibility = visibility;
        }

        const lessons = await lessonCollections.find(query).toArray();

        const publicLessonsCount = await lessonCollections.countDocuments({
          visibility: "Public",
        });

        const privateLessonsCount = await lessonCollections.countDocuments({
          visibility: "Private",
        });

        const flaggedLessonsCount = await reportCollections.countDocuments();

        res.json({
          lessons,
          publicLessonsCount,
          privateLessonsCount,
          flaggedLessonsCount,
        });
    });
      
    app.delete("/dashboard/admin/manage-lessons/:id", async (req, res) => {
        const result = await lessonCollections.deleteOne({
          _id: new ObjectId(req.params.id),
        });

        res.json(result);
    });

    app.patch("/dashboard/admin/manage-lessons/:id", async (req, res) => {
        const { featured, reviewed } = req.body;
        const update = {};

        if (featured !== undefined) {
          update.featured = featured;
        }

        if (reviewed !== undefined) {
          update.reviewed = reviewed;
        }

        const result = await lessonCollections.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: update }
        );

        res.json(result);
    });

    // --- REPORTS ENDPOINTS ---
    app.get("/dashboard/admin/reported-lessons", async (req, res) => {
      const reports = await reportCollections
        .aggregate([
          {
            $group: {
              _id: "$lessonId",
              reportCount: { $sum: 1 },
              reports: {
                $push: {
                  reason: "$reason",
                  reporterName: "$reporterName",
                  reporterEmail: "$reporterEmail",
                  timestamp: "$timestamp",
                },
              },
            },
          },
        ])
        .toArray();

      const result = await Promise.all(
        reports.map(async (report) => {
          const lesson = await lessonCollections.findOne({
            _id: new ObjectId(report._id),
          });

          return {
            lessonId: report._id,
            lessonTitle: lesson?.title ?? "Deleted Lesson",
            reportCount: report.reportCount,
            reports: report.reports,
          };
        })
      );

      res.json(result);
    });

    app.delete("/dashboard/admin/reported-lessons/:id", async (req, res) => {
      const { id } = req.params;

      await lessonCollections.deleteOne({ _id: new ObjectId(id) });
      await reportCollections.deleteMany({ lessonId: id });

      res.json({ success: true });
    });

    app.delete("/dashboard/admin/reported-lessons/:id/ignore", async (req, res) => {
      const { id } = req.params;
      await reportCollections.deleteMany({ lessonId: id });
      res.json({ success: true });
    });

    // --- USER DASHBOARD & PROFILE ROUTES ---
    app.get("/dashboard", async (req, res) => {
      const { email } = req.query;

      const totalLessons = await lessonCollections.countDocuments({
        creatorEmail: email,
      });

      const totalSaved = await lessonCollections.countDocuments({
        favorites: email,
      });

      const recentlyAdded = await lessonCollections
        .find({ creatorEmail: email })
        .sort({ createdDate: -1 })
        .limit(5)
        .toArray();

      const dashboard = {
        totalLessons,
        totalSaved,
        recentlyAdded,
      };

      res.json(dashboard);
    });

    // Favorites Display
    app.get("/dashboard/my-favorites", async (req, res) => {
      const { email, category, emotionalTone } = req.query;
      const query = { favorites: email };

      if (category) {
        query.category = category;
      }

      if (emotionalTone) {
        query.emotionalTone = emotionalTone;
      }

      const lessons = await lessonCollections
        .find(query)
        .sort({ createdDate: -1 })
        .toArray();

      res.json(lessons);
    });

    // Remove Favorite Action Handler
    app.patch("/dashboard/my-favorites/:id", async (req, res) => {
      const { id } = req.params;
      const { email } = req.body;

      const result = await lessonCollections.updateOne(
        { _id: new ObjectId(id) },
        { $pull: { favorites: email } }
      );

      res.json(result);
    });

    // User Profile Data Aggregation
    app.get("/dashboard/profile", async (req, res) => {
      const { email } = req.query;

      const user = await userCollection.findOne({ email });
      const totalLessons = await lessonCollections.countDocuments({ creatorEmail: email });
      const totalSaved = await lessonCollections.countDocuments({ favorites: email });

      const publicLessons = await lessonCollections
        .find({
          creatorEmail: email,
          visibility: "Public",
        })
        .sort({ createdDate: -1 })
        .toArray();

      res.json({
        user,
        totalLessons,
        totalSaved,
        publicLessons,
      });
    });

    // Update Profile Meta Values
    app.patch("/dashboard/profile/:id", async (req, res) => {
      const { id } = req.params;
      const { name, image } = req.body;

      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { name, image } }
      );

      res.json(result);
    });

  } catch (err) {
    console.error("Initialization Connection Error:", err);
  }
}

// Invoke Configuration Runner Setup Container Routine
run().catch(console.dir);

// Global fallback heartbeat routes
app.get('/', (req, res) => {
    res.send('hello world');
});

// Avoid port locks during remote continuous container lifecycle setups
if (process.env.NODE_ENV !== 'production') {
  app.listen(process.env.PORT || 5000, () => {
      console.log(`App is running on port ${process.env.PORT || 5000}`);
  });
}

// CRITICAL VERCEL ROUTING MIDDLEWARE BINDING EXPORT 
module.exports = app;