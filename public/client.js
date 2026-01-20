// ===== CONFIGURATION =====
const isProduction = window.location.hostname !== 'localhost' && 
                    window.location.hostname !== '127.0.0.1';

// Dynamic Socket.IO connection based on environment
const socketOptions = {
    // For production on Render
    transports: ['websocket', 'polling'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    forceNew: true,
    path: '/socket.io/'
};

// Initialize Socket.IO connection
const socket = isProduction 
    ? io(socketOptions) // Auto-connect to current host in production
    : io('http://localhost:3000', socketOptions); // Local development

// State Management
const state = {
    connected: false,
    username: 'Anonymous',
    userId: null,
    activeUsers: [],
    messages: [],
    typingUsers: new Set(),
    isTyping: false,
    typingTimeout: null,
    theme: localStorage.getItem('theme') || 'light',
    pingStartTime: null
};

// DOM Elements
const elements = {
    // Header
    statusIndicator: document.getElementById('statusIndicator'),
    connectionStatus: document.getElementById('connectionStatus'),
    userCount: document.getElementById('userCount'),
    pingValue: document.getElementById('pingValue'),
    shortId: document.getElementById('shortId'),
    fullConnectionId: document.getElementById('fullConnectionId'),
    
    // Theme
    themeToggle: document.getElementById('themeToggle'),
    
    // Sidebar
    activeUsersCount: document.getElementById('activeUsersCount'),
    usersContainer: document.getElementById('usersContainer'),
    clearChatBtn: document.getElementById('clearChatBtn'),
    
    // Chat
    messagesContainer: document.getElementById('messagesContainer'),
    typingIndicator: document.getElementById('typingIndicator'),
    typingText: document.getElementById('typingText'),
    
    // Input
    userAvatar: document.getElementById('userAvatar'),
    avatarText: document.getElementById('avatarText'),
    usernameInput: document.getElementById('usernameInput'),
    messageInput: document.getElementById('messageInput'),
    sendButton: document.getElementById('sendButton'),
    charCount: document.getElementById('charCount'),
    
    // Footer
    serverInfo: document.getElementById('serverInfo')
};

// Utility Functions
const utils = {
    generateColorFromId: (id) => {
        const colors = [
            '#4361ee', '#3a0ca3', '#4cc9f0', '#f72585',
            '#7209b7', '#560bad', '#480ca8', '#3a0ca3',
            '#4cc9f0', '#4895ef', '#4361ee', '#3f37c9'
        ];
        const hash = id ? id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0;
        return colors[hash % colors.length];
    },
    
    formatTime: (date = new Date()) => {
        return date.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
        });
    },
    
    escapeHtml: (text) => {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    getInitials: (name) => {
        if (!name || name.trim() === '') return 'A';
        return name.charAt(0).toUpperCase();
    },
    
    showToast: (message, type = 'info') => {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        
        // Add to body
        document.body.appendChild(toast);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.classList.add('toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

// UI Functions
const ui = {
    init: () => {
        console.log(`🌍 Environment: ${isProduction ? 'Production' : 'Development'}`);
        console.log(`🔗 Connecting to: ${isProduction ? window.location.origin : 'http://localhost:3000'}`);
        
        // Apply saved theme
        if (state.theme === 'dark') {
            document.body.classList.add('dark-mode');
            elements.themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
        }
        
        // Set initial avatar
        ui.updateUserAvatar();
        
        // Setup event listeners
        ui.setupEventListeners();
        
        // Show connection status
        ui.updateConnectionStatus('connecting');
        
        console.log('🚀 SocketChat Client initialized');
    },
    
    setupEventListeners: () => {
        // Theme toggle
        elements.themeToggle.addEventListener('click', ui.toggleTheme);
        
        // Message input
        elements.messageInput.addEventListener('input', () => {
            const length = elements.messageInput.value.length;
            elements.charCount.textContent = length;
            
            // Show typing indicator
            if (length > 0 && !state.isTyping) {
                socket.emit('typing', state.username);
                state.isTyping = true;
            }
            
            // Clear typing indicator after timeout
            clearTimeout(state.typingTimeout);
            state.typingTimeout = setTimeout(() => {
                if (state.isTyping) {
                    socket.emit('stop-typing');
                    state.isTyping = false;
                }
            }, 1500);
        });
        
        elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ui.sendMessage();
            }
        });
        
        // Send button
        elements.sendButton.addEventListener('click', ui.sendMessage);
        
        // Clear chat button
        elements.clearChatBtn.addEventListener('click', () => {
            if (confirm('Clear all messages in this chat?')) {
                state.messages = [];
                elements.messagesContainer.innerHTML = '';
                ui.showSystemMessage('Chat cleared', 'info');
            }
        });
        
        // Username change
        elements.usernameInput.addEventListener('change', () => {
            const newUsername = elements.usernameInput.value.trim() || 'Anonymous';
            if (newUsername !== state.username) {
                socket.emit('update-username', newUsername);
            }
        });
        
        elements.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const newUsername = elements.usernameInput.value.trim() || 'Anonymous';
                if (newUsername !== state.username) {
                    socket.emit('update-username', newUsername);
                }
            }
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+K to focus input
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                elements.messageInput.focus();
            }
            
            // Ctrl+U to focus username
            if (e.ctrlKey && e.key === 'u') {
                e.preventDefault();
                elements.usernameInput.focus();
                elements.usernameInput.select();
            }
            
            // Escape to clear input
            if (e.key === 'Escape') {
                elements.messageInput.value = '';
                elements.charCount.textContent = '0';
                if (state.isTyping) {
                    socket.emit('stop-typing');
                    state.isTyping = false;
                }
            }
        });
        
        // Window focus/blur events
        window.addEventListener('focus', () => {
            if (socket.disconnected) {
                socket.connect();
            }
        });
        
        window.addEventListener('blur', () => {
            if (state.isTyping) {
                socket.emit('stop-typing');
                state.isTyping = false;
            }
        });
    },
    
    toggleTheme: () => {
        const isDark = document.body.classList.toggle('dark-mode');
        state.theme = isDark ? 'dark' : 'light';
        localStorage.setItem('theme', state.theme);
        
        elements.themeToggle.innerHTML = isDark 
            ? '<i class="fas fa-sun"></i>' 
            : '<i class="fas fa-moon"></i>';
        
        utils.showToast(`Theme changed to ${state.theme} mode`, 'info');
    },
    
    sendMessage: () => {
        const message = elements.messageInput.value.trim();
        if (!message) return;
        
        socket.emit('send-message', {
            message: message,
            username: state.username
        });
        
        elements.messageInput.value = '';
        elements.charCount.textContent = '0';
        
        if (state.isTyping) {
            socket.emit('stop-typing');
            state.isTyping = false;
        }
        
        elements.messageInput.focus();
    },
    
    updateConnectionStatus: (status) => {
        switch(status) {
            case 'connecting':
                elements.statusIndicator.className = 'status-indicator connecting';
                elements.connectionStatus.textContent = 'Connecting...';
                elements.serverInfo.textContent = 'Establishing connection...';
                break;
            case 'connected':
                elements.statusIndicator.className = 'status-indicator connected';
                elements.connectionStatus.textContent = 'Connected';
                elements.serverInfo.textContent = isProduction 
                    ? `Connected to ${window.location.hostname}`
                    : 'Connected to local server';
                break;
            case 'disconnected':
                elements.statusIndicator.className = 'status-indicator';
                elements.connectionStatus.textContent = 'Disconnected';
                elements.serverInfo.textContent = 'Disconnected from server';
                break;
            case 'error':
                elements.statusIndicator.className = 'status-indicator error';
                elements.connectionStatus.textContent = 'Connection Error';
                elements.serverInfo.textContent = 'Connection error - Retrying...';
                break;
            case 'reconnecting':
                elements.statusIndicator.className = 'status-indicator reconnecting';
                elements.connectionStatus.textContent = 'Reconnecting...';
                elements.serverInfo.textContent = 'Reconnecting to server...';
                break;
        }
    },
    
    updateUserCount: (count) => {
        elements.userCount.textContent = count;
        elements.activeUsersCount.textContent = count;
    },
    
    updateActiveUsers: (users) => {
        state.activeUsers = users;
        elements.usersContainer.innerHTML = '';
        
        if (!users || users.length === 0) {
            elements.usersContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-user-clock"></i>
                    <p>No other users online</p>
                </div>
            `;
            return;
        }
        
        users.forEach(user => {
            if (!user || !user.id) return;
            
            const isCurrentUser = user.id === state.userId;
            const userEl = document.createElement('div');
            userEl.className = `user-item ${isCurrentUser ? 'current-user' : ''}`;
            userEl.innerHTML = `
                <div class="user-avatar" style="background: linear-gradient(135deg, ${utils.generateColorFromId(user.id)}, ${utils.generateColorFromId(user.id + '2')})">
                    ${utils.getInitials(user.username || 'User')}
                </div>
                <div class="user-details">
                    <div class="user-name">${utils.escapeHtml(user.username || 'User')} ${isCurrentUser ? '(You)' : ''}</div>
                    <div class="user-status">Online</div>
                </div>
            `;
            
            if (!isCurrentUser) {
                userEl.addEventListener('click', () => {
                    elements.messageInput.value = `@${user.username || 'User'} ${elements.messageInput.value}`;
                    elements.messageInput.focus();
                });
            }
            
            elements.usersContainer.appendChild(userEl);
        });
    },
    
    addMessage: (data) => {
        const isSystem = data.type === 'system';
        const isSelf = data.id === state.userId;
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isSystem ? 'system' : isSelf ? 'self' : 'other'}`;
        
        if (!isSystem) {
            messageEl.innerHTML = `
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-sender">${utils.escapeHtml(data.username || 'Anonymous')}</span>
                        <span class="message-time">${data.time || utils.formatTime()}</span>
                    </div>
                    <div class="message-bubble">${utils.escapeHtml(data.message)}</div>
                </div>
            `;
        } else {
            messageEl.innerHTML = `
                <div class="message-content">
                    <div class="message-bubble">${data.message}</div>
                </div>
            `;
        }
        
        // Remove welcome message if it exists
        const welcomeMessage = elements.messagesContainer.querySelector('.welcome-message');
        if (welcomeMessage && state.messages.length > 0) {
            welcomeMessage.style.display = 'none';
        }
        
        elements.messagesContainer.appendChild(messageEl);
        
        // Auto-scroll to bottom with animation
        requestAnimationFrame(() => {
            elements.messagesContainer.scrollTo({
                top: elements.messagesContainer.scrollHeight,
                behavior: 'smooth'
            });
        });
        
        // Store message
        state.messages.push(data);
        
        // Limit messages to prevent memory issues
        if (state.messages.length > 1000) {
            state.messages.shift();
            const firstMessage = elements.messagesContainer.querySelector('.message');
            if (firstMessage) firstMessage.remove();
        }
    },
    
    showSystemMessage: (text, type = 'info') => {
        ui.addMessage({
            type: 'system',
            message: text,
            time: utils.formatTime()
        });
    },
    
    showTypingIndicator: (username) => {
        elements.typingIndicator.classList.add('active');
        elements.typingText.textContent = `${username || 'Someone'} is typing...`;
    },
    
    hideTypingIndicator: () => {
        elements.typingIndicator.classList.remove('active');
        elements.typingText.textContent = '';
    },
    
    updateUserAvatar: () => {
        const color = utils.generateColorFromId(state.userId || 'anonymous');
        elements.userAvatar.style.background = `linear-gradient(135deg, ${color}, ${utils.generateColorFromId(state.userId + '2') || '#3a0ca3'})`;
        elements.avatarText.textContent = utils.getInitials(state.username);
    }
};

// Socket.IO Event Handlers
socket.on('connect', () => {
    console.log('✅ Connected to server');
    
    state.connected = true;
    state.userId = socket.id;
    ui.updateConnectionStatus('connected');
    
    elements.shortId.textContent = socket.id ? socket.id.substring(0, 6) : '------';
    elements.fullConnectionId.textContent = socket.id || 'Connecting...';
    
    // Update avatar
    ui.updateUserAvatar();
    
    utils.showToast('Connected to chat server', 'success');
});

socket.on('disconnect', (reason) => {
    console.log('❌ Disconnected:', reason);
    
    state.connected = false;
    ui.updateConnectionStatus('disconnected');
    
    if (reason === 'io server disconnect') {
        // Server initiated disconnect, need to manually reconnect
        socket.connect();
    }
    
    utils.showToast('Disconnected from server', 'error');
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    ui.updateConnectionStatus('error');
    utils.showToast(`Connection error: ${error.message}`, 'error');
});

socket.on('reconnect', (attemptNumber) => {
    console.log(`🔄 Reconnected after ${attemptNumber} attempts`);
    ui.updateConnectionStatus('connected');
    utils.showToast('Reconnected to server', 'success');
});

socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`🔄 Reconnect attempt ${attemptNumber}`);
    ui.updateConnectionStatus('reconnecting');
});

socket.on('reconnect_error', (error) => {
    console.error('Reconnect error:', error);
    ui.updateConnectionStatus('error');
});

socket.on('reconnect_failed', () => {
    console.error('Reconnect failed');
    utils.showToast('Failed to reconnect. Please refresh the page.', 'error');
});

socket.on('welcome', (data) => {
    console.log('👋 Welcome message received:', data);
    
    state.username = data.username || 'Anonymous';
    elements.usernameInput.value = state.username;
    ui.updateUserCount(data.usersCount || 0);
    
    ui.showSystemMessage(`Welcome ${state.username}! You are now connected to the chat.`);
    
    if (data.activeUsers) {
        ui.updateActiveUsers(data.activeUsers);
    }
    
    // Update UI elements
    ui.updateUserAvatar();
});

socket.on('user-count-update', (count) => {
    ui.updateUserCount(count);
});

socket.on('active-users-update', (users) => {
    ui.updateActiveUsers(users);
});

socket.on('user-joined', (data) => {
    const username = data.username || `User_${data.id ? data.id.substring(0, 6) : 'Unknown'}`;
    ui.showSystemMessage(`👋 ${username} joined the chat`);
});

socket.on('user-left', (data) => {
    const username = data.username || `User_${data.id ? data.id.substring(0, 6) : 'Unknown'}`;
    ui.showSystemMessage(`👋 ${username} left the chat`);
});

socket.on('new-message', (data) => {
    ui.addMessage(data);
});

socket.on('user-typing', (data) => {
    if (data.id !== state.userId) {
        ui.showTypingIndicator(data.username);
    }
});

socket.on('user-stop-typing', () => {
    ui.hideTypingIndicator();
});

socket.on('username-changed', (data) => {
    if (data.id === state.userId) {
        state.username = data.newUsername || state.username;
        elements.usernameInput.value = state.username;
        ui.updateUserAvatar();
        ui.showSystemMessage(`You changed your username to ${data.newUsername}`, 'info');
        utils.showToast('Username updated successfully', 'success');
    } else {
        const oldUsername = data.oldUsername || `User_${data.id ? data.id.substring(0, 6) : 'Unknown'}`;
        const newUsername = data.newUsername || `User_${data.id ? data.id.substring(0, 6) : 'Unknown'}`;
        ui.showSystemMessage(`🔄 ${oldUsername} changed their name to ${newUsername}`);
    }
});

socket.on('username-updated', (data) => {
    if (data.success) {
        state.username = data.newUsername || state.username;
        elements.usernameInput.value = state.username;
        ui.updateUserAvatar();
    }
});

socket.on('user-info', (data) => {
    if (data) {
        state.username = data.username || state.username;
        elements.usernameInput.value = state.username;
        ui.updateUserAvatar();
    }
});

socket.on('pong', (data) => {
    if (state.pingStartTime) {
        const latency = Date.now() - state.pingStartTime;
        elements.pingValue.textContent = latency < 100 ? '<100' : Math.round(latency);
        state.pingStartTime = null;
    }
});

socket.on('server-shutdown', (data) => {
    ui.showSystemMessage(`⚠️ ${data.message || 'Server is restarting. Please reconnect in a moment.'}`);
    utils.showToast('Server is restarting...', 'warning');
});

// Initialize the UI when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    ui.init();
    
    // Auto-clear typing indicator after 3 seconds
    setInterval(() => {
        if (elements.typingIndicator.classList.contains('active')) {
            ui.hideTypingIndicator();
        }
    }, 3000);
    
    // Ping server every 30 seconds to measure latency and keep connection alive
    setInterval(() => {
        if (socket.connected) {
            state.pingStartTime = Date.now();
            socket.emit('ping');
        }
    }, 30000);
    
    // Add toast styles
    const style = document.createElement('style');
    style.textContent = `
        .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--bg-primary);
            color: var(--text-primary);
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 1000;
            animation: toastSlideIn 0.3s ease;
            border-left: 4px solid var(--primary-color);
        }
        
        .toast-success {
            border-left-color: #06d6a0;
        }
        
        .toast-error {
            border-left-color: #ef476f;
        }
        
        .toast-info {
            border-left-color: #4361ee;
        }
        
        .toast-warning {
            border-left-color: #ffd166;
        }
        
        .toast-hide {
            animation: toastSlideOut 0.3s ease forwards;
        }
        
        @keyframes toastSlideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes toastSlideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        .status-indicator.connecting {
            background: #ffd166;
            animation: pulse 2s infinite;
        }
        
        .status-indicator.reconnecting {
            background: #ffd166;
            animation: pulse-fast 1s infinite;
        }
        
        .status-indicator.error {
            background: #ef476f;
            animation: pulse 1s infinite;
        }
        
        @keyframes pulse-fast {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }
    `;
    document.head.appendChild(style);
});

// Export for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { socket, state, ui, utils };
}