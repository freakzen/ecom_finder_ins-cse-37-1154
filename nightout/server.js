const express = require('express');
const cors = require('cors');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const axios = require('axios');
const cheerio = require('cheerio');
const Redis = require('ioredis');
const Bull = require('bull');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Redis cache setup
const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

// Bull queue setup
const crawlQueue = new Bull('website-crawler', {
  redis: { host: 'localhost', port: 6379 },
});

const emailQueue = new Bull('email-finder', {
  redis: { host: 'localhost', port: 6379 },
});

// Cache middleware
const cache = async (req, res, next) => {
  const { url } = req.query;
  if (!url) return next();

  try {
    const cached = await redis.get(url);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    next();
  } catch (err) {
    next();
  }
};

// API Endpoints
app.post('/api/fetch-websites', async (req, res) => {
  const { country, keyword, industry, count } = req.body;
  
  try {
    // Add job to queue and return job ID
    const job = await crawlQueue.add({
      country,
      keyword,
      industry,
      count: Math.min(count, 1000), // Limit to 1000 max
    });

    res.json({ jobId: job.id });
  } catch (error) {
    console.error('Error adding job to queue:', error);
    res.status(500).json({ error: 'Failed to start website fetch' });
  }
});

app.post('/api/fetch-emails', async (req, res) => {
  const { urls } = req.body;
  
  try {
    const job = await emailQueue.add({ urls });
    res.json({ jobId: job.id });
  } catch (error) {
    console.error('Error adding email job to queue:', error);
    res.status(500).json({ error: 'Failed to start email fetch' });
  }
});

app.get('/api/job-status/:jobId', async (req, res) => {
  try {
    const job = await crawlQueue.getJob(req.params.jobId) || 
                 await emailQueue.getJob(req.params.jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      status: await job.getState(),
      progress: job.progress(),
      result: job.returnvalue,
    });
  } catch (error) {
    console.error('Error checking job status:', error);
    res.status(500).json({ error: 'Failed to check job status' });
  }
});

// Worker process for website crawling
if (!isMainThread) {
  const { urls, jobId } = workerData;
  const results = [];
  
  (async () => {
    try {
      // Process URLs in batches of 10
      for (let i = 0; i < urls.length; i += 10) {
        const batch = urls.slice(i, i + 10);
        const batchResults = await Promise.all(batch.map(crawlWebsite));
        
        // Filter out null results and add to main results
        results.push(...batchResults.filter(Boolean));
        
        // Update progress
        parentPort.postMessage({ 
          progress: Math.min((i + batch.length) / urls.length * 100, 100),
          results: batchResults.filter(Boolean),
        });
      }
      
      parentPort.postMessage({ done: true, results });
    } catch (error) {
      parentPort.postMessage({ error: error.message });
    }
  })();
}

async function crawlWebsite(url) {
  try {
    // Check cache first
    const cached = await redis.get(`website:${url}`);
    if (cached) return JSON.parse(cached);

    // Lightweight check if domain is active
    const headResponse = await axios.head(url, { timeout: 5000 }).catch(() => null);
    if (!headResponse) return null;

    // Check if Shopify (lightweight check)
    const isShopify = await checkShopify(url);

    const result = {
      url,
      isActive: true,
      isShopify,
      loadTime: null, // Would be measured in real implementation
    };

    // Cache result for 24 hours
    await redis.set(`website:${url}`, JSON.stringify(result), 'EX', 86400);
    
    return result;
  } catch (error) {
    console.error(`Error crawling ${url}:`, error.message);
    return null;
  }
}

async function checkShopify(url) {
  try {
    // Check common Shopify indicators without full page load
    const response = await axios.get(url, {
      timeout: 5000,
      headers: { 'Accept': 'text/html' },
    });
    
    const $ = cheerio.load(response.data);
    
    // Check for Shopify indicators
    const shopifyIndicators = [
      $('meta[name="shopify-checkout-api-token"]').length > 0,
      $('link[href*="shopify.com"]').length > 0,
      response.headers['x-shopid'] !== undefined,
      response.data.includes('Shopify.theme')
    ];
    
    return shopifyIndicators.some(Boolean);
  } catch (error) {
    return false;
  }
}

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start worker processes
  startWorkers();
});

function startWorkers() {
  // Start website crawler workers
  crawlQueue.process(5, async (job) => { // 5 concurrent workers
    return new Promise((resolve) => {
      const worker = new Worker(__filename, {
        workerData: {
          urls: generateUrls(job.data), // This would be your URL generation logic
          jobId: job.id,
        },
      });
      
      let results = [];
      
      worker.on('message', (msg) => {
        if (msg.progress) {
          job.progress(msg.progress);
        }
        if (msg.results) {
          results.push(...msg.results);
        }
        if (msg.done) {
          resolve(results);
        }
        if (msg.error) {
          throw new Error(msg.error);
        }
      });
    });
  });
  
  // Start email finder workers
  emailQueue.process(5, async (job) => {
    const { urls } = job.data;
    const results = [];
    
    for (let i = 0; i < urls.length; i += 5) { // Process in batches of 5
      const batch = urls.slice(i, i + 5);
      const batchResults = await Promise.all(batch.map(findEmails));
      results.push(...batchResults.filter(Boolean));
      job.progress((i + batch.length) / urls.length * 100);
    }
    
    return results;
  });
}

async function findEmails(url) {
  try {
    // Check cache first
    const cached = await redis.get(`emails:${url}`);
    if (cached) return { url, emails: JSON.parse(cached) };

    const response = await axios.get(url, { timeout: 5000 });
    const emails = extractEmails(response.data);
    
    if (emails.length > 0) {
      await redis.set(`emails:${url}`, JSON.stringify(emails), 'EX', 86400);
      return { url, emails };
    }
    
    return null;
  } catch (error) {
    console.error(`Error finding emails for ${url}:`, error.message);
    return null;
  }
}

function extractEmails(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = text.match(emailRegex) || [];
  
  // Filter out common personal emails
  return emails.filter(email => 
    !email.endsWith('@gmail.com') && 
    !email.endsWith('@yahoo.com') &&
    !email.endsWith('@outlook.com') &&
    !email.endsWith('@hotmail.com')
  );
}

function generateUrls({ country, keyword, industry, count }) {
  // This would be replaced with actual URL generation logic
  // For demo purposes, we'll generate dummy URLs
  const urls = [];
  const baseDomains = {
    us: 'example.com',
    ca: 'example.ca',
    uk: 'example.co.uk',
    au: 'example.com.au',
    in: 'example.in',
  };
  
  for (let i = 0; i < count; i++) {
    const domain = baseDomains[country] || 'example.com';
    urls.push(`https://${keyword || 'shop'}-${industry || 'store'}-${i}.${domain}`);
  }
  
  return urls;
}