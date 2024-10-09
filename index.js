const express = require('express');
const promClient = require('prom-client');
const axios = require('axios');
const { transports, format, createLogger } = require('winston');
const LokiTransport = require('winston-loki');

// Create an Express app
const app = express();

// Prometheus client setup
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ timeout: 5000 }); // Collect default system metrics

// Create a Prometheus counter and histogram
const requestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests made',
  labelNames: ['method', 'endpoint', 'status']
});

const responseTimeHistogram = new promClient.Histogram({
  name: 'http_response_time_seconds',
  help: 'HTTP response time in seconds',
  labelNames: ['method', 'endpoint', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 50, 100, 200, 500, 1000] // Buckets for response times
});

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.File({ filename: '/var/log/app/app.log' }), // Store logs locally
    new transports.Console() // Optionally, log to console as well
  ]
});


// Middleware to log requests and measure response times
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000; // Convert to seconds
    const status = res.statusCode;

    // Increment Prometheus metrics
    requestCounter.inc({ method: req.method, endpoint: req.path, status });
    responseTimeHistogram.observe({ method: req.method, endpoint: req.path, status }, duration);

    // Log the request to Loki
    logger.info('Request completed', {
      method: req.method,
      endpoint: req.path,
      status,
      duration,
      time: new Date().toISOString()
    });
  });
  next();
});

// Normal API endpoint
app.get('/normal', (req, res) => {
  res.json({ message: 'This is a normal API response' });
});

// Unpredictable API endpoint
app.get('/abnormal', async (req, res) => {
  const random = Math.random();

  if (random < 0.3) {
    // Simulate fast response
    return res.json({ message: 'Fast response' });
  } else if (random < 0.6) {
    // Simulate error response
    res.status(500).json({ error: 'Internal Server Error' });
  } else {
    // Simulate slow response
    await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds delay
    res.json({ message: 'Slow response' });
  }
});

// Expose Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

// Start the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  console.log(`Server running on port ${PORT}`);
});
