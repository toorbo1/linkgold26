const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'linkgold-secret-key-2024';
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log('🔧 Запуск сервера LinkGold...');

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

function initializeDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT UNIQUE,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            balance REAL DEFAULT 0,
            completed_tasks INTEGER DEFAULT 0,
            active_tasks INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            level_progress INTEGER DEFAULT 0,
            is_admin BOOLEAN DEFAULT 0,
            referral_code TEXT UNIQUE,
            referred_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

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

        db.run(`CREATE TABLE IF NOT EXISTS user_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            task_id INTEGER,
            status TEXT DEFAULT 'pending',
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            photo_url TEXT,
            comment TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS referrals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id TEXT,
            referred_id TEXT,
            earned_amount REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.get("SELECT * FROM users WHERE telegram_id = '8036875641'", (err, row) => {
            if (!row) {
                const referralCode = 'GOLD' + Math.random().toString(36).substr(2, 8).toUpperCase();
                db.run("INSERT INTO users (telegram_id, username, first_name, is_admin, referral_code) VALUES ('8036875641', 'LinkGoldAdmin', 'Администратор', 1, ?)", 
                    [referralCode]);
                console.log('✅ Главный администратор создан');
            }
        });

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

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

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

// ==================== API ENDPOINTS ====================

app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Сервер работает', 
        timestamp: new Date().toISOString() 
    });
});

// Аутентификация через Telegram - ВАЖНО: берем реальные данные из Telegram
app.post('/api/auth/telegram', (req, res) => {
    const { telegramId, username, firstName, lastName, referralCode } = req.body;

    if (!telegramId) {
        return res.status(400).json({ success: false, error: 'Telegram ID обязателен' });
    }

    db.get(`SELECT u.*, 
                   (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.telegram_id) as referral_count,
                   (SELECT COALESCE(SUM(earned_amount), 0) FROM referrals WHERE referrer_id = u.telegram_id) as referral_earned
            FROM users u WHERE u.telegram_id = ?`, [telegramId], (err, user) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }

        if (user) {
            // Обновляем данные существующего пользователя
            db.run("UPDATE users SET username = ?, first_name = ?, last_name = ? WHERE telegram_id = ?",
                [username || user.username, firstName || user.first_name, lastName || user.last_name, telegramId],
                function(err) {
                    if (err) {
                        console.error('Ошибка обновления пользователя:', err);
                    }
                    
                    db.get(`SELECT u.*, 
                           (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.telegram_id) as referral_count,
                           (SELECT COALESCE(SUM(earned_amount), 0) FROM referrals WHERE referrer_id = u.telegram_id) as referral_earned
                    FROM users u WHERE u.telegram_id = ?`, [telegramId], (err, updatedUser) => {
                        const token = jwt.sign({
                            telegramId: updatedUser.telegram_id,
                            username: updatedUser.username,
                            firstName: updatedUser.first_name,
                            isAdmin: updatedUser.is_admin === 1
                        }, JWT_SECRET, { expiresIn: '24h' });

                        res.json({
                            success: true,
                            token,
                            user: {
                                telegramId: updatedUser.telegram_id,
                                username: updatedUser.username,
                                firstName: updatedUser.first_name,
                                lastName: updatedUser.last_name,
                                balance: updatedUser.balance,
                                completedTasks: updatedUser.completed_tasks,
                                activeTasks: updatedUser.active_tasks,
                                level: updatedUser.level,
                                levelProgress: updatedUser.level_progress,
                                isAdmin: updatedUser.is_admin === 1,
                                referralCode: updatedUser.referral_code,
                                referrals: {
                                    invited: updatedUser.referral_count,
                                    earned: updatedUser.referral_earned
                                }
                            }
                        });
                    });
                }
            );
        } else {
            // Создаем нового пользователя
            const newReferralCode = 'GOLD' + Math.random().toString(36).substr(2, 8).toUpperCase();
            let referredBy = null;

            if (referralCode) {
                db.get("SELECT telegram_id FROM users WHERE referral_code = ?", [referralCode], (err, referrer) => {
                    if (referrer && referrer.telegram_id !== telegramId) {
                        referredBy = referrer.telegram_id;
                    }
                    createNewUser();
                });
            } else {
                createNewUser();
            }

            function createNewUser() {
                db.run("INSERT INTO users (telegram_id, username, first_name, last_name, referral_code, referred_by) VALUES (?, ?, ?, ?, ?, ?)",
                    [telegramId, username || `user_${telegramId}`, firstName || 'User', lastName || '', newReferralCode, referredBy],
                    function(err) {
                        if (err) {
                            return res.status(500).json({ success: false, error: 'Ошибка создания пользователя' });
                        }

                        if (referredBy) {
                            db.run("INSERT INTO referrals (referrer_id, referred_id, earned_amount) VALUES (?, ?, ?)", 
                                [referredBy, telegramId, 50]);
                            db.run("UPDATE users SET balance = balance + 50 WHERE telegram_id = ?", [referredBy]);
                        }

                        const token = jwt.sign({
                            telegramId,
                            username: username || `user_${telegramId}`,
                            firstName: firstName || 'User',
                            isAdmin: false
                        }, JWT_SECRET, { expiresIn: '24h' });

                        res.json({
                            success: true,
                            token,
                            user: {
                                telegramId,
                                username: username || `user_${telegramId}`,
                                firstName: firstName || 'User',
                                lastName: lastName || '',
                                balance: 0,
                                completedTasks: 0,
                                activeTasks: 0,
                                level: 1,
                                levelProgress: 0,
                                isAdmin: false,
                                referralCode: newReferralCode,
                                referrals: {
                                    invited: 0,
                                    earned: 0
                                }
                            }
                        });
                    }
                );
            }
        }
    });
});

// Получение заданий - ВАЖНО: все пользователи видят одни и те же задания
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

// ДОБАВЛЕНИЕ ЗАДАНИЯ - ВАЖНО: только для админа
app.post('/api/tasks', authenticateToken, (req, res) => {
    const { title, category, price, description, time, link } = req.body;

    // Проверяем, является ли пользователь администратором
    db.get("SELECT is_admin FROM users WHERE telegram_id = ?", [req.user.telegramId], (err, user) => {
        if (err || !user || user.is_admin !== 1) {
            return res.status(403).json({ success: false, error: 'Доступ запрещен' });
        }

        db.run("INSERT INTO tasks (title, category, price, description, time, link, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [title, category, price, description, time, link, req.user.telegramId],
            function(err) {
                if (err) {
                    return res.status(500).json({ success: false, error: 'Ошибка добавления задания' });
                }
                res.json({ success: true, message: 'Задание добавлено', taskId: this.lastID });
            }
        );
    });
});

app.post('/api/tasks/start', authenticateToken, (req, res) => {
    const { taskId } = req.body;

    db.get("SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?", [req.user.telegramId, taskId], (err, existingTask) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }

        if (existingTask) {
            return res.status(400).json({ success: false, error: 'Вы уже начали это задание' });
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

app.get('/api/user/profile', authenticateToken, (req, res) => {
    db.get(`SELECT u.*, 
                   (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.telegram_id) as referral_count,
                   (SELECT COALESCE(SUM(earned_amount), 0) FROM referrals WHERE referrer_id = u.telegram_id) as referral_earned
            FROM users u WHERE u.telegram_id = ?`, [req.user.telegramId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }

        res.json({
            success: true,
            user: {
                telegramId: user.telegram_id,
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name,
                balance: user.balance,
                completedTasks: user.completed_tasks,
                activeTasks: user.active_tasks,
                level: user.level,
                levelProgress: user.level_progress,
                isAdmin: user.is_admin === 1,
                referralCode: user.referral_code,
                referrals: {
                    invited: user.referral_count,
                    earned: user.referral_earned
                }
            }
        });
    });
});

app.get('/api/user/tasks', authenticateToken, (req, res) => {
    const { status } = req.query;
    let query = `
        SELECT ut.*, t.title, t.price, t.category, t.description 
        FROM user_tasks ut 
        JOIN tasks t ON ut.task_id = t.id 
        WHERE ut.user_id = ?
    `;
    let params = [req.user.telegramId];

    if (status) {
        query += " AND ut.status = ?";
        params.push(status);
    }

    query += " ORDER BY ut.submitted_at DESC";

    db.all(query, params, (err, tasks) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Ошибка БД' });
        }
        res.json({ success: true, tasks: tasks || [] });
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
    console.error('❌ Ошибка:', err);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
});

initializeDatabase();

app.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('✅ Сервер запущен!');
    console.log(`📍 http://localhost:${PORT}`);
    console.log('================================');
});