const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Указываем правильный путь к public
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Сервер работает!',
        timestamp: new Date().toISOString()
    });
});

// Аутентификация
app.post('/api/auth/telegram', (req, res) => {
    const { telegramId, username, firstName } = req.body;
    
    console.log('📨 Получены данные:', { telegramId, username, firstName });
    
    res.json({
        success: true,
        user: {
            telegramId,
            username,
            firstName,
            isAdmin: telegramId === "8036875641"
        }
    });
});

// Задания
app.get('/api/tasks', (req, res) => {
    res.json({
        success: true,
        tasks: [
            {
                id: 1,
                title: "Подписка на Telegram канал",
                category: "subscribe",
                price: 15,
                description: "Подпишитесь на канал и оставайтесь подписанным 3 дня",
                time: "5 мин",
                link: "https://t.me/linkgold_channel",
                available: 10,
                status: "active"
            },
            {
                id: 2,
                title: "Просмотр YouTube видео", 
                category: "view",
                price: 10,
                description: "Посмотрите видео до конца и поставьте лайk",
                time: "10 мин",
                link: "https://youtube.com",
                available: 20,
                status: "active"
            }
        ]
    });
});

// Добавление задания
app.post('/api/tasks', (req, res) => {
    console.log('📝 Добавление задания:', req.body);
    res.json({ 
        success: true, 
        message: 'Задание добавлено!'
    });
});

// Все остальные запросы
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('✅ Сервер запущен!');
    console.log(`📍 Порт: ${PORT}`);
    console.log('================================');
});