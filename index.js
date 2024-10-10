const express = require('express');
const promClient = require('prom-client');
const { transports, format, createLogger } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Create an Express app
const app = express();

// Prometheus client setup
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ timeout: 5000 }); // Collect default system metrics

// Create a Prometheus counter and histogram
const requestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests made',
  labelNames: ['method', 'endpoint', 'status'],
});

const responseTimeHistogram = new promClient.Histogram({
  name: 'http_response_time_seconds',
  help: 'HTTP response time in seconds',
  labelNames: ['method', 'endpoint', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 50, 100, 200, 500, 1000], // Buckets for response times
});

// Create logger configuration
const logger = createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.colorize(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new transports.Console(),
    new DailyRotateFile({
      filename: path.join(__dirname, 'logs', 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      level: 'info',
    }),
    new DailyRotateFile({
      filename: path.join(__dirname, 'logs', 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      level: 'error',
    }),
  ],
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

    // Log the request completion
    logger.info('Request completed', {
      method: req.method,
      endpoint: req.path,
      status,
      duration,
      time: new Date().toISOString(),
    });
  });
  next();
});

// Normal API endpoint
app.get('/normal', (req, res) => {
  logger.info('Normal endpoint called'); // Log when this endpoint is accessed
  res.json({ message: 'This is a normal API response' });
});

// Unpredictable API endpoint
app.get('/abnormal', async (req, res) => {
  const random = Math.random();

  logger.info('Abnormal endpoint called'); // Log when this endpoint is accessed

  if (random < 0.3) {
    // Simulate fast response
    res.json({ message: 'Fast response' });
    logger.info('Fast response sent'); // Log fast response
  } else if (random < 0.6) {
    // Simulate error response
    res.status(500).json({ error: 'Internal Server Error' });
    logger.error('Internal Server Error occurred', { endpoint: req.path, method: req.method }); // Log error
  } else {
    // Simulate slow response
    await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds delay
    res.json({ message: 'Slow response' });
    logger.info('Slow response sent'); // Log slow response
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
