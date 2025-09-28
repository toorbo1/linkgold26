const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('/tmp/linkgold.db');

// Инициализация БД
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        telegram_id TEXT UNIQUE,
        username TEXT,
        first_name TEXT,
        is_admin BOOLEAN DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        title TEXT,
        category TEXT,
        price REAL,
        description TEXT,
        link TEXT
    )`);
    
    // Добавляем тестовые задания
    db.get("SELECT COUNT(*) as count FROM tasks", (err, row) => {
        if (row.count === 0) {
            const tasks = [
                ['Подписка на канал', 'subscribe', 15, 'Подпишитесь на канал', 'https://t.me/linkgold'],
                ['Просмотр видео', 'view', 10, 'Посмотрите видео', 'https://youtube.com']
            ];
            const stmt = db.prepare("INSERT INTO tasks (title, category, price, description, link) VALUES (?, ?, ?, ?, ?)");
            tasks.forEach(task => stmt.run(task));
            stmt.finalize();
        }
    });
});

// Аутентификация
app.post('/api/auth/telegram', (req, res) => {
    const { telegramId, username, firstName } = req.body;
    
    console.log('🔐 Аутентификация:', { telegramId, username, firstName });

    const isAdmin = telegramId === "8036875641";

    db.run("INSERT OR REPLACE INTO users (telegram_id, username, first_name, is_admin) VALUES (?, ?, ?, ?)",
        [telegramId, username, firstName, isAdmin],
        function(err) {
            if (err) {
                console.error('❌ Ошибка БД:', err);
                return res.status(500).json({ success: false, error: 'Ошибка БД' });
            }

            res.json({
                success: true,
                user: {
                    telegramId,
                    username,
                    firstName, 
                    isAdmin
                }
            });
        }
    );
});

// Получение заданий
app.get('/api/tasks', (req, res) => {
    db.all("SELECT * FROM tasks", (err, tasks) => {
        res.json({ success: true, tasks: tasks || [] });
    });
});

// Добавление задания
app.post('/api/tasks', (req, res) => {
    const { title, category, price, description, link } = req.body;

    db.run("INSERT INTO tasks (title, category, price, description, link) VALUES (?, ?, ?, ?, ?)",
        [title, category, price, description, link],
        function(err) {
            if (err) {
                return res.status(500).json({ success: false, error: 'Ошибка добавления' });
            }
            res.json({ success: true, message: 'Задание добавлено' });
        }
    );
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});