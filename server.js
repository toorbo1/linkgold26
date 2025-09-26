const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const jwt = require('jsonwebtoken');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Конфигурация
const JWT_SECRET = process.env.JWT_SECRET || 'linkgold-secret-key-2024';
const NODE_ENV = process.env.NODE_ENV || 'development';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';

console.log('🔧 Запуск сервера LinkGold...');
console.log('🌍 Режим:', NODE_ENV);
console.log('🚪 Порт:', PORT);

// Инициализация Telegram бота
let bot = null;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== 'YOUR_BOT_TOKEN') {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('🤖 Telegram бот запущен');
}

// База данных
const dbPath = process.env.NODE_ENV === 'production' 
    ? '/tmp/linkgold.db' 
    : path.join(__dirname, 'linkgold.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Ошибка БД:', err.message);
    } else {
        console.log('✅ База данных подключена');
    }
});

// Инициализация БД
function initializeDatabase() {
    db.serialize(() => {
        // Пользователи
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT UNIQUE,
            username TEXT,
            first_name TEXT,
            balance REAL DEFAULT 0,
            completed_tasks INTEGER DEFAULT 0,
            active_tasks INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            level_progress INTEGER DEFAULT 0,
            is_admin BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Задания
        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT,
            price REAL DEFAULT 0,
            description TEXT,
            time TEXT,
            link TEXT,
            admin_id TEXT,
            available INTEGER DEFAULT 10,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Выполненные задания
        db.run(`CREATE TABLE IF NOT EXISTS user_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            task_id INTEGER,
            status TEXT DEFAULT 'pending',
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            photo_url TEXT,
            comment TEXT,
            admin_review TEXT
        )`);

        // Сообщения чата
        db.run(`CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            message TEXT,
            is_admin BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            telegram_message_id TEXT
        )`);

        // Уведомления для админов
        db.run(`CREATE TABLE IF NOT EXISTS admin_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            user_id TEXT,
            task_id INTEGER,
            message TEXT,
            is_read BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Главный админ
        db.get("SELECT * FROM users WHERE telegram_id = '8036875641'", (err, row) => {
            if (!row) {
                db.run("INSERT INTO users (telegram_id, username, first_name, is_admin) VALUES ('8036875641', '@LinkGoldAdmin', 'Администратор', 1)");
            }
        });

        // Демо-задания
        db.get("SELECT COUNT(*) as count FROM tasks", (err, row) => {
            if (row.count === 0) {
                const tasks = [
                    ['Подписка на Telegram канал', 'subscribe', 15, 'Подпишитесь на канал и оставайтесь подписанным 3 дня', '5 мин', 'https://t.me/linkgold_channel', '8036875641'],
                    ['Просмотр YouTube видео', 'view', 10, 'Посмотрите видео до конца и поставьте лайк', '10 мин', 'https://youtube.com', '8036875641'],
                    ['Комментарий в группе', 'comment', 20, 'Оставьте содержательный комментарий', '7 мин', 'https://t.me/test_group', '8036875641']
                ];
                
                const stmt = db.prepare("INSERT INTO tasks (title, category, price, description, time, link, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
                tasks.forEach(task => stmt.run(task));
                stmt.finalize();
                console.log('✅ Демо-задания добавлены');
            }
        });
    });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Логирование
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

// Проверка JWT токена
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'Токен отсутствует' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, error: 'Неверный токен' });
        }
        req.user = user;
        next();
    });
};

// Функция для отправки уведомлений админам
function notifyAdmins(type, message, userData = null, taskData = null) {
    if (!bot) return;

    db.all("SELECT telegram_id FROM users WHERE is_admin = 1", (err, admins) => {
        if (err) {
            console.error('Ошибка получения списка админов:', err);
            return;
        }

        admins.forEach(admin => {
            let notificationMessage = `🔔 ${message}`;
            
            if (userData) {
                notificationMessage += `\n👤 Пользователь: ${userData.username || 'Неизвестно'} (${userData.telegramId})`;
            }
            
            if (taskData) {
                notificationMessage += `\n📋 Задание: ${taskData.title}`;
                notificationMessage += `\n💰 Сумма: ${taskData.price} руб.`;
            }

            notificationMessage += `\n⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

            // Добавляем кнопки для быстрых действий
            const keyboard = {
                inline_keyboard: []
            };

            if (type === 'new_task_submission' && taskData) {
                keyboard.inline_keyboard.push([
                    { text: '✅ Принять задание', callback_data: `approve_${taskData.id}_${userData.telegramId}` },
                    { text: '❌ Отклонить', callback_data: `reject_${taskData.id}_${userData.telegramId}` }
                ]);
            }

            if (type === 'support_message' && userData) {
                keyboard.inline_keyboard.push([
                    { text: '💬 Ответить', callback_data: `support_${userData.telegramId}` }
                ]);
            }

            bot.sendMessage(admin.telegram_id, notificationMessage, {
                reply_markup: keyboard
            }).catch(err => {
                console.error('Ошибка отправки уведомления админу:', err);
            });
        });
    });
}

// Обработка callback от Telegram
if (bot) {
    bot.on('callback_query', (callbackQuery) => {
        const message = callbackQuery.message;
        const data = callbackQuery.data;
        const [action, taskId, userId] = data.split('_');

        if (action === 'approve') {
            // Одобрение задания
            db.get("SELECT * FROM user_tasks WHERE id = ?", [taskId], (err, userTask) => {
                if (userTask) {
                    db.run("UPDATE user_tasks SET status = 'approved' WHERE id = ?", [taskId]);
                    db.run("UPDATE users SET balance = balance + ?, completed_tasks = completed_tasks + 1, active_tasks = active_tasks - 1 WHERE telegram_id = ?", 
                          [userTask.task_id, userId]);

                    // Уведомляем пользователя
                    bot.sendMessage(userId, `✅ Ваше задание одобрено! На ваш баланс зачислено ${userTask.price} руб.`);

                    // Обновляем сообщение у админа
                    bot.editMessageText(`✅ Задание одобрено\nПользователь: ${userId}\nСумма: ${userTask.price} руб.`, {
                        chat_id: message.chat.id,
                        message_id: message.message_id
                    });
                }
            });
        } else if (action === 'reject') {
            // Отклонение задания
            db.run("UPDATE user_tasks SET status = 'rejected' WHERE id = ?", [taskId]);
            
            // Уведомляем пользователя
            bot.sendMessage(userId, `❌ Ваше задание отклонено. Если это ошибка, обратитесь в поддержку.`);

            // Обновляем сообщение у админа
            bot.editMessageText(`❌ Задание отклонено\nПользователь: ${userId}`, {
                chat_id: message.chat.id,
                message_id: message.message_id
            });
        } else if (action === 'support') {
            // Ответ на сообщение поддержки
            bot.sendMessage(message.chat.id, `💬 Введите ответ для пользователя ${userId}:`);
            // Здесь можно добавить логику для ожидания ответа админа
        }
    });

    // Обработка сообщений от пользователей
    bot.on('message', (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        // Проверяем, является ли отправитель админом
        db.get("SELECT is_admin FROM users WHERE telegram_id = ?", [chatId.toString()], (err, user) => {
            if (user && user.is_admin) {
                // Логика для админов
                if (text.startsWith('/addtask')) {
                    const parts = text.split('|');
                    if (parts.length >= 6) {
                        const task = {
                            title: parts[1],
                            category: parts[2],
                            price: parseFloat(parts[3]),
                            description: parts[4],
                            time: parts[5],
                            link: parts[6] || '',
                            admin_id: chatId.toString()
                        };

                        db.run("INSERT INTO tasks (title, category, price, description, time, link, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            [task.title, task.category, task.price, task.description, task.time, task.link, task.admin_id]);

                        bot.sendMessage(chatId, '✅ Задание добавлено!');
                    } else {
                        bot.sendMessage(chatId, '❌ Формат: /addtask|Название|Категория|Цена|Описание|Время|Ссылка');
                    }
                }
            }
        });
    });
}

// ==================== API ENDPOINTS ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Сервер работает', 
        timestamp: new Date().toISOString() 
    });
});

// Аутентификация через Telegram
app.post('/api/auth/telegram', (req, res) => {
    const { telegramId, username, firstName, authData } = req.body;

    if (!telegramId) {
        return res.status(400).json({ success: false, error: 'Telegram ID обязателен' });
    }

    // Валидация данных Telegram Web App
    if (authData) {
        // Здесь можно добавить проверку хэша для безопасности
        console.log('Auth data received:', authData);
    }

    db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }

        if (user) {
            // Существующий пользователь
            const token = jwt.sign({
                telegramId: user.telegram_id,
                username: user.username,
                isAdmin: user.is_admin === 1
            }, JWT_SECRET, { expiresIn: '24h' });

            res.json({
                success: true,
                token,
                user: {
                    telegramId: user.telegram_id,
                    username: user.username,
                    firstName: user.first_name,
                    balance: user.balance,
                    completedTasks: user.completed_tasks,
                    activeTasks: user.active_tasks,
                    level: user.level,
                    levelProgress: user.level_progress,
                    isAdmin: user.is_admin === 1
                }
            });
        } else {
            // Новый пользователь
            db.run("INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)",
                [telegramId, username || `user_${telegramId}`, firstName || 'User'],
                function(err) {
                    if (err) {
                        return res.status(500).json({ success: false, error: 'Ошибка создания пользователя' });
                    }

                    const token = jwt.sign({
                        telegramId,
                        username: username || `user_${telegramId}`,
                        isAdmin: false
                    }, JWT_SECRET, { expiresIn: '24h' });

                    // Уведомляем админов о новом пользователе
                    notifyAdmins('new_user', '🎉 Новый пользователь зарегистрировался!', {
                        telegramId,
                        username: username || `user_${telegramId}`,
                        firstName: firstName || 'User'
                    });

                    res.json({
                        success: true,
                        token,
                        user: {
                            telegramId,
                            username: username || `user_${telegramId}`,
                            firstName: firstName || 'User',
                            balance: 0,
                            completedTasks: 0,
                            activeTasks: 0,
                            level: 1,
                            levelProgress: 0,
                            isAdmin: false
                        }
                    });
                }
            );
        }
    });
});

// Получение заданий
app.get('/api/tasks', authenticateToken, (req, res) => {
    const { search, category } = req.query;
    let query = "SELECT * FROM tasks WHERE status = 'active'";
    let params = [];

    if (search) {
        query += " AND (title LIKE ? OR description LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }

    if (category && category !== 'all') {
        query += " AND category = ?";
        params.push(category);
    }

    query += " ORDER BY created_at DESC";

    db.all(query, params, (err, tasks) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }
        res.json({ success: true, tasks: tasks || [] });
    });
});

// Запуск задания
app.post('/api/tasks/start', authenticateToken, (req, res) => {
    const { taskId } = req.body;

    db.get("SELECT * FROM tasks WHERE id = ?", [taskId], (err, task) => {
        if (err || !task) {
            return res.status(404).json({ success: false, error: 'Задание не найдено' });
        }

        db.run("INSERT INTO user_tasks (user_id, task_id) VALUES (?, ?)",
            [req.user.telegramId, taskId],
            function(err) {
                if (err) {
                    return res.status(500).json({ success: false, error: 'Ошибка начала задания' });
                }

                db.run("UPDATE users SET active_tasks = active_tasks + 1 WHERE telegram_id = ?",
                    [req.user.telegramId]);

                // Уведомляем админов
                notifyAdmins('task_started', '🚀 Пользователь начал выполнение задания', 
                    req.user, task);

                res.json({ success: true, message: 'Задание начато', taskId: this.lastID });
            }
        );
    });
});

// Подтверждение выполнения задания
app.post('/api/tasks/confirm', authenticateToken, (req, res) => {
    const { taskId, photo, comment } = req.body;

    db.get("SELECT * FROM user_tasks WHERE id = ? AND user_id = ?", [taskId, req.user.telegramId], (err, userTask) => {
        if (err || !userTask) {
            return res.status(404).json({ success: false, error: 'Задание не найдено' });
        }

        db.run("UPDATE user_tasks SET status = 'submitted', photo_url = ?, comment = ? WHERE id = ?",
            [photo, comment, taskId],
            function(err) {
                if (err) {
                    return res.status(500).json({ success: false, error: 'Ошибка подтверждения задания' });
                }

                // Получаем данные задания для уведомления
                db.get("SELECT t.* FROM tasks t JOIN user_tasks ut ON t.id = ut.task_id WHERE ut.id = ?", [taskId], (err, task) => {
                    if (task) {
                        // Уведомляем админов о новом задании на проверку
                        notifyAdmins('new_task_submission', '📸 Новое задание отправлено на проверку', 
                            req.user, task);
                    }

                    res.json({ success: true, message: 'Задание отправлено на проверку' });
                });
            }
        );
    });
});

// Профиль пользователя
app.get('/api/user/profile', authenticateToken, (req, res) => {
    db.get("SELECT * FROM users WHERE telegram_id = ?", [req.user.telegramId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }

        res.json({
            success: true,
            user: {
                telegramId: user.telegram_id,
                username: user.username,
                firstName: user.first_name,
                balance: user.balance,
                completedTasks: user.completed_tasks,
                activeTasks: user.active_tasks,
                level: user.level,
                levelProgress: user.level_progress,
                isAdmin: user.is_admin === 1
            }
        });
    });
});

// Сообщения чата
app.get('/api/chat/messages', authenticateToken, (req, res) => {
    db.all("SELECT * FROM chats WHERE user_id = ? ORDER BY created_at ASC",
        [req.user.telegramId],
        (err, messages) => {
            if (err) {
                return res.status(500).json({ success: false, error: 'Ошибка БД' });
            }
            res.json({ success: true, messages: messages || [] });
        }
    );
});

app.post('/api/chat/messages', authenticateToken, (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ success: false, error: 'Сообщение обязательно' });
    }

    db.run("INSERT INTO chats (user_id, message) VALUES (?, ?)",
        [req.user.telegramId, message],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, error: 'Ошибка отправки' });
            }

            // Уведомляем админов о новом сообщении в поддержке
            notifyAdmins('support_message', '💬 Новое сообщение в поддержку', req.user);

            res.json({ success: true, message: 'Сообщение отправлено' });
        }
    );
});

// Задания пользователя
app.get('/api/user/tasks', authenticateToken, (req, res) => {
    const query = `
        SELECT ut.*, t.title, t.price, t.category 
        FROM user_tasks ut 
        JOIN tasks t ON ut.task_id = t.id 
        WHERE ut.user_id = ? 
        ORDER BY ut.submitted_at DESC
    `;

    db.all(query, [req.user.telegramId], (err, tasks) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }
        res.json({ success: true, tasks: tasks || [] });
    });
});

// API для админов
app.get('/api/admin/tasks', authenticateToken, (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ success: false, error: 'Доступ запрещен' });
    }

    const query = `
        SELECT ut.*, t.title, t.price, u.username, u.telegram_id 
        FROM user_tasks ut 
        JOIN tasks t ON ut.task_id = t.id 
        JOIN users u ON ut.user_id = u.telegram_id 
        WHERE ut.status = 'submitted'
        ORDER BY ut.submitted_at DESC
    `;

    db.all(query, (err, tasks) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }
        res.json({ success: true, tasks: tasks || [] });
    });
});

app.post('/api/admin/tasks/:taskId/approve', authenticateToken, (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ success: false, error: 'Доступ запрещен' });
    }

    const { taskId } = req.params;

    db.get("SELECT ut.*, t.price FROM user_tasks ut JOIN tasks t ON ut.task_id = t.id WHERE ut.id = ?", [taskId], (err, userTask) => {
        if (err || !userTask) {
            return res.status(404).json({ success: false, error: 'Задание не найдено' });
        }

        db.serialize(() => {
            db.run("UPDATE user_tasks SET status = 'approved' WHERE id = ?", [taskId]);
            db.run("UPDATE users SET balance = balance + ?, completed_tasks = completed_tasks + 1, active_tasks = active_tasks - 1 WHERE telegram_id = ?", 
                  [userTask.price, userTask.user_id]);

            // Уведомляем пользователя через Telegram
            if (bot) {
                bot.sendMessage(userTask.user_id, 
                    `✅ Ваше задание "${userTask.title}" одобрено! На баланс зачислено ${userTask.price} руб.`
                ).catch(err => console.error('Ошибка отправки уведомления:', err));
            }

            res.json({ success: true, message: 'Задание одобрено' });
        });
    });
});

app.post('/api/admin/tasks/:taskId/reject', authenticateToken, (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ success: false, error: 'Доступ запрещен' });
    }

    const { taskId } = req.params;

    db.run("UPDATE user_tasks SET status = 'rejected' WHERE id = ?", [taskId], function(err) {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }

        // Уведомляем пользователя через Telegram
        db.get("SELECT ut.*, t.title FROM user_tasks ut JOIN tasks t ON ut.task_id = t.id WHERE ut.id = ?", [taskId], (err, userTask) => {
            if (userTask && bot) {
                bot.sendMessage(userTask.user_id, 
                    `❌ Ваше задание "${userTask.title}" отклонено. Если это ошибка, обратитесь в поддержку.`
                ).catch(err => console.error('Ошибка отправки уведомления:', err));
            }
        });

        res.json({ success: true, message: 'Задание отклонено' });
    });
});

// SPA роут
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('❌ Ошибка:', err);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
});

// Запуск сервера
initializeDatabase();

app.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('✅ Сервер запущен!');
    console.log(`📍 http://localhost:${PORT}`);
    console.log('================================');
});