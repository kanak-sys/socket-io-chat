const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors'); // Add this line

const app = express();
const server = http.createServer(app);

// ===== MIDDLEWARE CONFIGURATION =====
// Enable CORS for production
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://socket-io-chat.onrender.com', 'https://your-custom-domain.com'] 
        : ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// ===== SOCKET.IO CONFIGURATION =====
const io = socketIO(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production'
            ? ['https://socket-io-chat.onrender.com', 'https://your-custom-domain.com']
            : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080'],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'], // Important for Render
    allowEIO3: true, // Socket.IO v2 compatibility
    pingTimeout: 60000, // Increase for Render
    pingInterval: 25000,
    cookie: false
});

// ===== STORE ACTIVE USERS =====
const activeUsers = new Map();

// ===== SERVE STATIC FILES =====
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== ROUTES =====
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint (REQUIRED for Render)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        activeUsers: activeUsers.size
    });
});

// API endpoints
app.get('/api/users', (req, res) => {
    res.json({
        success: true,
        count: activeUsers.size,
        users: Array.from(activeUsers.values()).map(user => ({
            id: user.id,
            username: user.username,
            connectedAt: user.connectedAt,
            lastSeen: user.lastSeen
        }))
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        status: 'running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        activeConnections: activeUsers.size,
        environment: process.env.NODE_ENV || 'development'
    });
});

// 404 handler
app.use('*', (req, res) => {
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else if (req.accepts('json')) {
        res.status(404).json({ error: 'Not found' });
    } else {
        res.status(404).send('Not found');
    }
});

// ===== SOCKET.IO EVENT HANDLERS =====
io.on('connection', (socket) => {
    console.log(`✅ New connection: ${socket.id} from ${socket.handshake.address}`);
    
    const defaultUsername = `User_${socket.id.substring(0, 6)}`;
    
    // Add user to active users
    activeUsers.set(socket.id, {
        id: socket.id,
        username: defaultUsername,
        ip: socket.handshake.address,
        connectedAt: new Date().toISOString(),
        lastSeen: new Date().toISOString()
    });

    // Send welcome message
    socket.emit('welcome', {
        message: 'Welcome to SocketChat!',
        id: socket.id,
        username: defaultUsername,
        usersCount: activeUsers.size,
        serverTime: new Date().toISOString(),
        serverVersion: '1.0.0'
    });

    // Notify other users
    socket.broadcast.emit('user-joined', {
        id: socket.id,
        username: defaultUsername,
        time: new Date().toLocaleTimeString()
    });

    // Update user count for everyone
    io.emit('user-count-update', activeUsers.size);
    io.emit('active-users-update', Array.from(activeUsers.values()));

    // Handle messages
    socket.on('send-message', (data) => {
        const user = activeUsers.get(socket.id) || { username: defaultUsername };
        
        console.log(`📩 Message from ${socket.id}: ${data.message.substring(0, 50)}...`);
        
        io.emit('new-message', {
            id: socket.id,
            message: data.message,
            time: new Date().toLocaleTimeString(),
            timestamp: new Date().toISOString(),
            username: data.username || user.username
        });
        
        // Update last seen
        if (activeUsers.has(socket.id)) {
            activeUsers.get(socket.id).lastSeen = new Date().toISOString();
        }
    });

    // Handle typing
    socket.on('typing', (username) => {
        const user = activeUsers.get(socket.id);
        const displayName = username || user?.username || defaultUsername;
        
        socket.broadcast.emit('user-typing', {
            id: socket.id,
            username: displayName
        });
    });

    socket.on('stop-typing', () => {
        socket.broadcast.emit('user-stop-typing', socket.id);
    });

    // Handle username change
    socket.on('update-username', (newUsername) => {
        const user = activeUsers.get(socket.id);
        const oldUsername = user?.username || defaultUsername;
        const sanitizedUsername = newUsername.trim() || defaultUsername;
        
        if (activeUsers.has(socket.id)) {
            activeUsers.get(socket.id).username = sanitizedUsername;
        }
        
        io.emit('username-changed', {
            id: socket.id,
            oldUsername: oldUsername,
            newUsername: sanitizedUsername,
            time: new Date().toLocaleTimeString()
        });
        
        io.emit('active-users-update', Array.from(activeUsers.values()));
        
        socket.emit('username-updated', {
            success: true,
            newUsername: sanitizedUsername
        });
    });

    // Handle ping (for connection health)
    socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
        console.log(`❌ Disconnected: ${socket.id} (${reason})`);
        
        const user = activeUsers.get(socket.id);
        activeUsers.delete(socket.id);
        
        if (user) {
            io.emit('user-left', {
                id: socket.id,
                username: user.username,
                reason: reason
            });
        }
        
        io.emit('user-count-update', activeUsers.size);
        io.emit('active-users-update', Array.from(activeUsers.values()));
    });

    // Error handling
    socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error.message);
    });
});

// ===== ERROR HANDLING MIDDLEWARE =====
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
});

// ===== GRACEFUL SHUTDOWN =====
const gracefulShutdown = () => {
    console.log('🛑 Received shutdown signal, closing connections...');
    
    // Notify all clients
    io.emit('server-shutdown', {
        message: 'Server is restarting. Please reconnect in a moment.',
        timestamp: new Date().toISOString()
    });
    
    // Close Socket.IO
    io.close(() => {
        console.log('✅ Socket.IO closed');
        
        // Close HTTP server
        server.close(() => {
            console.log('✅ HTTP server closed');
            process.exit(0);
        });
        
        // Force close after 5 seconds
        setTimeout(() => {
            console.log('⚠️ Forcing shutdown...');
            process.exit(1);
        }, 5000);
    });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Important for Render

server.listen(PORT, HOST, () => {
    console.log(`🚀 Server started on ${HOST}:${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`⚡ Process ID: ${process.pid}`);
    console.log(`👤 Health check: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/health`);
});

// Compression
const compression = require('compression');
app.use(compression());

// Rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Export for testing
module.exports = { app, server, io };