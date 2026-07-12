require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();

const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000', 
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
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    
    const db = client.db('wisdr-server');
    const userDB = client.db('wisdr-users');
    const userCollection = userDB.collection('user');
    const lessonCollections = db.collection('lessons');
    const commentCollections = db.collection('comments');
    const reportCollections = db.collection('reports');
    
    app.post('/dashboard/add-lesson', async(req, res) => {
        const data = req.body;
        const result = await lessonCollections.insertOne(data);
        res.send(result);
    })

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

      // 1. Assembling dynamic query filtering objects
      let queryObject = {};

      // Filter by Search Match (Title/Description Keyword)
      if (search) {
        queryObject.$or = [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } }
        ];
      }

      // Filter by Exact Match Category
      if (category) {
        queryObject.category = category;
      }

      // Filter by Exact Match Emotional Tone
      if (emotionalTone) {
        queryObject.emotionalTone = emotionalTone;
      }

      // 2. Setting up Sort execution configuration rules
      let sortObject = {};
      if (sort === "most-saved") {
        sortObject.savedCount = -1; // Assuming your items contain a numeric field 'savedCount'
      } else {
        sortObject.createdDate = -1; // Default fallback to newest listings
      }

      // 3. Perform accurate math pagination skipping calculations
      const skipAmount = (page - 1) * limitOnePage;

      // Execute queries concurrently using Promise.all to optimize execution speed
      const [cursor, totalDoc] = await Promise.all([
        lessonCollections
          .find(queryObject)
          .sort(sortObject)
          .skip(skipAmount)
          .limit(limitOnePage)
          .toArray(),
        lessonCollections.countDocuments(queryObject) // Crucial: Count matching criteria documents, not everything!
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
      // Querying database collection for matching object identifier strings safely
      const lesson = await lessonCollections.findOne({ _id: new ObjectId(id) });
      if (!lesson) return res.status(404).json({ message: "Lesson document not found" });
      res.send(lesson);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // B. Toggle Like Implementation Endpoint Handler
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
        // Remove email from likes array, decrement count
        updateOperation = {
          $pull: { likes: email },
          $inc: { likesCount: -1 }
        };
      } else {
        // Add email to likes array, increment count
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

  // C. Toggle Favorites Save Functionality Route Handler
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

  // D. Fetch Comments Feed Array
  app.get('/public/:id/comments', async (req, res) => {
    try {
      const { id } = req.params;
      // Pull comments ordered newest first
      const comments = await commentCollections.find({ lessonId: id }).sort({ createdDate: -1 }).toArray();
      res.json(comments);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // E. Add New Comment Action Route Handler
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

  // F. Create Entry in content Flag Reports Collection Route Handler
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

// admin profile 

app.get("/dashboard/admin/profile", async (req, res) => {
  const { email } = req.query;

  const admin = await userCollection.findOne({ email });

  if (!admin) {
    return res.status(404).json({ message: "Admin not found" });
  }

  res.json(admin);
});

// subscription successfull

app.patch("/pricing/success", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await userCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // Keep admins as admins
    if (user.role === "admin") {
      return res.json({
        success: true,
        role: "admin",
        message: "Admin role unchanged.",
      });
    }

    // Upgrade normal users to pro
    await userCollection.updateOne(
      { email },
      {
        $set: {
          role: "pro",
        },
      }
    );

    res.json({
      success: true,
      role: "pro",
      message: "Subscription activated.",
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});



  // check session token for stripe payment : subscription check

  // G. total users
  app.get("/dashboard/admin", async (req, res) => {
    const today = new Date().toISOString().split("T")[0];

    const userCount = await userCollection.countDocuments();
    const publicLessonCount = await lessonCollections.countDocuments();
    const reportCount = await reportCollections.countDocuments();

    const todayNewLessons = await lessonCollections
      .find({
        createdDate: { $regex: `^${today}` },
      })
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
        {
          $sort: {
            totalLessons: -1,
          },
        },
        {
          $limit: 5,
        },
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
// H. Get all users with total lessons
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

  // I. Update user role
  app.patch("/dashboard/admin/manage-users/:id", async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    const result = await userCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: { role },
      }
    );

    res.json(result);
  });
    
  // manage- lessons by admin 

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
      {
        _id: new ObjectId(req.params.id),
      },
      {
        $set: update,
      }
    );

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
      {
        $set: update,
      }
    );

    res.json(result);
  });

  // report 

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

  await lessonCollections.deleteOne({
    _id: new ObjectId(id),
  });

  await reportCollections.deleteMany({
    lessonId: id,
  });

  res.json({
    success: true,
  });
});

app.delete("/dashboard/admin/reported-lessons/:id/ignore", async (req, res) => {
  const { id } = req.params;

  await reportCollections.deleteMany({
    lessonId: id,
  });

  res.json({
    success: true,
  });
});

// users dashboard 

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

// favorite

app.get("/dashboard/my-favorites", async (req, res) => {
  const { email, category, emotionalTone } = req.query;

  const query = {
    favorites: email,
  };

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
// remove favorite 

app.patch("/dashboard/my-favorites/:id", async (req, res) => {
  const { id } = req.params;
  const { email } = req.body;

  const result = await lessonCollections.updateOne(
    { _id: new ObjectId(id) },
    {
      $pull: {
        favorites: email,
      },
    }
  );

  res.json(result);
});
// user profile 

app.get("/dashboard/profile", async (req, res) => {
  const { email } = req.query;

  const user = await userCollection.findOne({ email });

  const totalLessons = await lessonCollections.countDocuments({
    creatorEmail: email,
  });

  const totalSaved = await lessonCollections.countDocuments({
    favorites: email,
  });

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
// update profile 
app.patch("/dashboard/profile/:id", async (req, res) => {
  const { id } = req.params;
  const { name, image } = req.body;

  const result = await userCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        name,
        image,
      },
    }
  );

  res.json(result);
});
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('hello world');
})
app.listen(process.env.PORT, () => {
    console.log(`app is running on port ${process.env.PORT}`)
})