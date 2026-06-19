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
    const lessonCollections = db.collection('lessons');
    const commentCollections = db.collection('comments');
    const reportCollections = db.collection('reports')
    
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
    
    app.get('/public', async(req, res) => {
        const cursor = await lessonCollections.find().toArray(); 
        res.send(cursor);
    })
    

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
  app.post('/reports', async (req, res) => {
    try {
      const payload = {
        ...req.body,
        timestamp: new Date(req.body.timestamp)
      };
      await reportCollections.insertOne(payload);
      res.status(201).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // check session token for stripe payment : subscription check


  
    
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