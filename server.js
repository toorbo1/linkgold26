const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// В начале server.js
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-development-only';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'fallback-bot-token';
const MAIN_ADMIN_ID = process.env.MAIN_ADMIN_ID || '8036875641';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Добавьте предупреждение в разработке
if (NODE_ENV === 'development' && (!process.env.JWT_SECRET || !process.env.TELEGRAM_BOT_TOKEN)) {
    console.warn('⚠️  Используются значения по умолчанию. Создайте .env файл для production!');
}

console.log('🔧 Запуск сервера LinkGold...');
console.log('🌍 Режим:', NODE_ENV);
console.log('🚪 Порт:', PORT);

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
            admin_reviewed BOOLEAN DEFAULT 0,
            reviewed_by TEXT,
            reviewed_at DATETIME
        )`);

        // Сообщения чата
        db.run(`CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            message TEXT,
            is_admin BOOLEAN DEFAULT 0,
            admin_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Главный админ
        db.get("SELECT * FROM users WHERE telegram_id = ?", [MAIN_ADMIN_ID], (err, row) => {
            if (!row) {
                db.run("INSERT INTO users (telegram_id, username, first_name, is_admin) VALUES (?, '@LinkGoldAdmin', 'Администратор', 1)", 
                    [MAIN_ADMIN_ID]);
                console.log('✅ Главный админ создан');
            }
        });

        // Демо-задания
        db.get("SELECT COUNT(*) as count FROM tasks", (err, row) => {
            if (row.count === 0) {
                const tasks = [
                    ['Подписка на Telegram канал', 'subscribe', 15, 'Подпишитесь на канал и оставайтесь подписанным 3 дня', '5 мин', 'https://t.me/linkgold_channel', MAIN_ADMIN_ID],
                    ['Просмотр YouTube видео', 'view', 10, 'Посмотрите видео до конца и поставьте лайк', '10 мин', 'https://youtube.com', MAIN_ADMIN_ID],
                    ['Комментарий в группе', 'comment', 20, 'Оставьте содержательный комментарий', '7 мин', 'https://t.me/test_group', MAIN_ADMIN_ID]
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
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Валидация данных Telegram Web App
function validateTelegramData(telegramData) {
    if (!telegramData.hash || NODE_ENV === 'development') {
        return true; // Пропускаем проверку в разработке
    }

    const dataToCheck = { ...telegramData };
    delete dataToCheck.hash;

    const sortedKeys = Object.keys(dataToCheck).sort();
    const dataCheckString = sortedKeys
        .map(key => `${key}=${dataToCheck[key]}`)
        .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData')
        .update(TELEGRAM_BOT_TOKEN)
        .digest();

    const calculatedHash = crypto.createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    return calculatedHash === telegramData.hash;
}

// Парсинг данных из Telegram initData
function parseTelegramInitData(initData) {
    try {
        const params = new URLSearchParams(initData);
        const result = {};
        
        for (const [key, value] of params) {
            result[key] = value;
        }
        
        // Парсим user object если он есть
        if (result.user) {
            try {
                result.user = JSON.parse(result.user);
            } catch (e) {
                console.log('❌ Ошибка парсинга user object');
            }
        }
        
        return result;
    } catch (error) {
        console.error('❌ Ошибка парсинга initData:', error);
        return {};
    }
}

// Middleware для проверки Telegram Web App
const checkTelegramOrigin = (req, res, next) => {
    const telegramInitData = req.headers['telegram-init-data'] || req.query.tgWebAppData;
    
    if (!telegramInitData) {
        if (NODE_ENV === 'development') {
            console.log('⚠️ Режим разработки: пропускаем проверку Telegram');
            req.telegramUser = {
                id: '123456789',
                username: 'test_user',
                first_name: 'Test',
                last_name: 'User'
            };
            return next();
        }
        return res.status(403).json({ 
            success: false, 
            error: 'Доступ только через Telegram Web App' 
        });
    }

    try {
        const telegramData = parseTelegramInitData(telegramInitData);
        
        if (!validateTelegramData(telegramData)) {
            return res.status(403).json({ 
                success: false, 
                error: 'Невалидные данные Telegram' 
            });
        }

        req.telegramUser = {
            id: telegramData.user?.id || telegramData.id || 'unknown',
            username: telegramData.user?.username || telegramData.username,
            first_name: telegramData.user?.first_name || telegramData.first_name,
            last_name: telegramData.user?.last_name || telegramData.last_name,
            photo_url: telegramData.user?.photo_url || telegramData.photo_url
        };

        next();
    } catch (error) {
        console.error('❌ Ошибка валидации Telegram:', error);
        return res.status(403).json({ 
            success: false, 
            error: 'Ошибка проверки данных Telegram' 
        });
    }
};

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

// Проверка прав администратора
const requireAdmin = (req, res, next) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ success: false, error: 'Требуются права администратора' });
    }
    next();
};

// Проверка прав главного администратора
const requireMainAdmin = (req, res, next) => {
    if (!req.user.isAdmin || req.user.telegramId !== MAIN_ADMIN_ID) {
        return res.status(403).json({ success: false, error: 'Требуются права главного администратора' });
    }
    next();
};

// ==================== API ENDPOINTS ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Сервер работает', 
        timestamp: new Date().toISOString() 
    });
});

// Аутентификация через Telegram Web App
app.post('/api/auth/telegram', checkTelegramOrigin, (req, res) => {
    const { telegramUser } = req;

    if (!telegramUser.id) {
        return res.status(400).json({ success: false, error: 'Telegram ID обязателен' });
    }

    db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramUser.id], (err, user) => {
        if (err) {
            console.error('❌ Ошибка БД:', err);
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
                    isAdmin: user.is_admin === 1,
                    isMainAdmin: user.telegram_id === MAIN_ADMIN_ID
                }
            });
        } else {
            // Новый пользователь
            db.run("INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)",
                [telegramUser.id, telegramUser.username || `user_${telegramUser.id}`, telegramUser.first_name || 'User'],
                function(err) {
                    if (err) {
                        console.error('❌ Ошибка создания пользователя:', err);
                        return res.status(500).json({ success: false, error: 'Ошибка создания пользователя' });
                    }

                    const token = jwt.sign({
                        telegramId: telegramUser.id,
                        username: telegramUser.username || `user_${telegramUser.id}`,
                        isAdmin: false
                    }, JWT_SECRET, { expiresIn: '24h' });

                    res.json({
                        success: true,
                        token,
                        user: {
                            telegramId: telegramUser.id,
                            username: telegramUser.username || `user_${telegramUser.id}`,
                            firstName: telegramUser.first_name || 'User',
                            balance: 0,
                            completedTasks: 0,
                            activeTasks: 0,
                            level: 1,
                            levelProgress: 0,
                            isAdmin: false,
                            isMainAdmin: false
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

    // Проверяем, не начал ли пользователь уже это задание
    db.get("SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ? AND status = 'pending'", 
        [req.user.telegramId, taskId], (err, existingTask) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }

        if (existingTask) {
            return res.status(400).json({ success: false, error: 'Задание уже начато' });
        }

        db.run("INSERT INTO user_tasks (user_id, task_id) VALUES (?, ?)",
            [req.user.telegramId, taskId],
            function(err) {
                if (err) {
                    return res.status(500).json({ success: false, error: 'Ошибка начала задания' });
                }

                db.run("UPDATE users SET active_tasks = active_tasks + 1 WHERE telegram_id = ?",
                    [req.user.telegramId]);

                res.json({ success: true, message: 'Задание начато' });
            }
        );
    });
});

// Подтверждение задания
app.post('/api/tasks/confirm', authenticateToken, (req, res) => {
    const { taskId, photo, comment } = req.body;

    db.run("UPDATE user_tasks SET status = 'submitted', photo_url = ?, comment = ? WHERE user_id = ? AND task_id = ? AND status = 'pending'",
        [photo, comment, req.user.telegramId, taskId],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, error: 'Ошибка подтверждения задания' });
            }

            if (this.changes === 0) {
                return res.status(400).json({ success: false, error: 'Задание не найдено или уже подтверждено' });
            }

            db.run("UPDATE users SET active_tasks = active_tasks - 1 WHERE telegram_id = ?",
                [req.user.telegramId]);

            res.json({ success: true, message: 'Задание отправлено на проверку' });
        }
    );
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
                isAdmin: user.is_admin === 1,
                isMainAdmin: user.telegram_id === MAIN_ADMIN_ID
            }
        });
    });
});

// Сообщения чата
app.get('/api/chat/messages', authenticateToken, (req, res) => {
    db.all(`SELECT c.*, u.username 
            FROM chats c 
            LEFT JOIN users u ON c.user_id = u.telegram_id 
            WHERE c.user_id = ? 
            ORDER BY c.created_at ASC`,
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
            res.json({ success: true, message: 'Сообщение отправлено' });
        }
    );
});

// Задания пользователя
app.get('/api/user/tasks', authenticateToken, (req, res) => {
    const query = `
        SELECT ut.*, t.title, t.price, t.category, t.description, t.time
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

// ==================== АДМИН ENDPOINTS ====================

// Получение заданий на проверку
app.get('/api/admin/tasks/review', authenticateToken, requireAdmin, (req, res) => {
    const query = `
        SELECT ut.*, t.title, t.price, t.category, u.username, u.telegram_id
        FROM user_tasks ut 
        JOIN tasks t ON ut.task_id = t.id 
        JOIN users u ON ut.user_id = u.telegram_id 
        WHERE ut.status = 'submitted' 
        ORDER BY ut.submitted_at ASC
    `;

    db.all(query, [], (err, tasks) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }
        res.json({ success: true, tasks: tasks || [] });
    });
});

// Одобрение задания
app.post('/api/admin/tasks/approve', authenticateToken, requireAdmin, (req, res) => {
    const { taskId } = req.body;

    db.serialize(() => {
        // Получаем информацию о задании
        db.get(`SELECT ut.*, t.price, ut.user_id 
                FROM user_tasks ut 
                JOIN tasks t ON ut.task_id = t.id 
                WHERE ut.id = ?`, [taskId], (err, task) => {
            if (err || !task) {
                return res.status(404).json({ success: false, error: 'Задание не найдено' });
            }

            // Обновляем статус задания
            db.run("UPDATE user_tasks SET status = 'approved', admin_reviewed = 1, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
                [req.user.telegramId, taskId],
                function(err) {
                    if (err) {
                        return res.status(500).json({ success: false, error: 'Ошибка БД' });
                    }

                    // Начисляем деньги пользователю
                    db.run("UPDATE users SET balance = balance + ?, completed_tasks = completed_tasks + 1, level_progress = level_progress + 1 WHERE telegram_id = ?",
                        [task.price, task.user_id],
                        function(err) {
                            if (err) {
                                return res.status(500).json({ success: false, error: 'Ошибка начисления' });
                            }

                            // Проверяем уровень
                            db.get("SELECT level_progress, level FROM users WHERE telegram_id = ?", [task.user_id], (err, user) => {
                                if (user.level_progress >= 10) {
                                    db.run("UPDATE users SET level = level + 1, level_progress = 0 WHERE telegram_id = ?", [task.user_id]);
                                }

                                res.json({ success: true, message: 'Задание одобрено' });
                            });
                        }
                    );
                }
            );
        });
    });
});

// Отклонение задания
app.post('/api/admin/tasks/reject', authenticateToken, requireAdmin, (req, res) => {
    const { taskId } = req.body;

    db.run("UPDATE user_tasks SET status = 'rejected', admin_reviewed = 1, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
        [req.user.telegramId, taskId],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, error: 'Ошибка БД' });
            }

            res.json({ success: true, message: 'Задание отклонено' });
        }
    );
});

// Создание задания
app.post('/api/admin/tasks', authenticateToken, requireAdmin, (req, res) => {
    const { title, category, price, description, time, link } = req.body;

    if (!title || !category || !price || !description || !time || !link) {
        return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }

    db.run("INSERT INTO tasks (title, category, price, description, time, link, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [title, category, price, description, time, link, req.user.telegramId],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, error: 'Ошибка создания задания' });
            }

            res.json({ success: true, message: 'Задание создано', taskId: this.lastID });
        }
    );
});

// Удаление задания
app.delete('/api/admin/tasks/:id', authenticateToken, requireAdmin, (req, res) => {
    const taskId = req.params.id;

    db.run("DELETE FROM tasks WHERE id = ? AND admin_id = ?", [taskId, req.user.telegramId], function(err) {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка удаления задания' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Задание не найдено или нет прав' });
        }

        res.json({ success: true, message: 'Задание удалено' });
    });
});

// Управление админами (только для главного админа)
app.get('/api/admin/admins', authenticateToken, requireMainAdmin, (req, res) => {
    db.all("SELECT telegram_id, username, first_name, is_admin FROM users WHERE is_admin = 1", [], (err, admins) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }
        res.json({ success: true, admins: admins || [] });
    });
});

app.post('/api/admin/admins', authenticateToken, requireMainAdmin, (req, res) => {
    const { telegramId } = req.body;

    if (!telegramId) {
        return res.status(400).json({ success: false, error: 'Telegram ID обязателен' });
    }

    db.run("UPDATE users SET is_admin = 1 WHERE telegram_id = ?", [telegramId], function(err) {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }

        res.json({ success: true, message: 'Пользователь назначен администратором' });
    });
});

app.delete('/api/admin/admins/:telegramId', authenticateToken, requireMainAdmin, (req, res) => {
    const telegramId = req.params.telegramId;

    if (telegramId === MAIN_ADMIN_ID) {
        return res.status(400).json({ success: false, error: 'Нельзя удалить главного администратора' });
    }

    db.run("UPDATE users SET is_admin = 0 WHERE telegram_id = ?", [telegramId], function(err) {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }

        res.json({ success: true, message: 'Права администратора удалены' });
    });
});

// SPA роут с проверкой Telegram
app.get('*', checkTelegramOrigin, (req, res) => {
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

