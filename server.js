const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// Получаем переменные из окружения Railway
const JWT_SECRET = process.env.JWT_SECRET || 'linkgold-default-secret';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Проверка конфигурации
console.log('=== 🔧 КОНФИГУРАЦИЯ СЕРВЕРА ===');
console.log('🌍 NODE_ENV:', NODE_ENV);
console.log('🔑 JWT_SECRET:', JWT_SECRET ? '***' + JWT_SECRET.slice(-4) : 'NOT SET');
console.log('🚪 PORT:', PORT);
console.log('================================');

// Путь к базе данных
const dbPath = NODE_ENV === 'production' 
  ? '/tmp/linkgold.db' 
  : path.join(__dirname, 'linkgold.db');

console.log('📊 Путь к БД:', dbPath);

// Подключение к базе данных
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err.message);
  } else {
    console.log('✅ Подключение к SQLite установлено');
  }
});

// Инициализация базы данных
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Таблица пользователей
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
      )`, (err) => {
        if (err) {
          console.error('❌ Ошибка создания таблицы users:', err.message);
        } else {
          console.log('✅ Таблица users готова');
        }
      });

      // Таблица заданий
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
      )`, (err) => {
        if (err) {
          console.error('❌ Ошибка создания таблицы tasks:', err.message);
        } else {
          console.log('✅ Таблица tasks готова');
        }
      });

      // Таблица выполненных заданий
      db.run(`CREATE TABLE IF NOT EXISTS user_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        task_id INTEGER,
        status TEXT DEFAULT 'pending',
        photo_url TEXT,
        comment TEXT,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME,
        reviewed_by TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks (id)
      )`, (err) => {
        if (err) {
          console.error('❌ Ошибка создания таблицы user_tasks:', err.message);
        } else {
          console.log('✅ Таблица user_tasks готова');
        }
      });

      // Таблица сообщений чата
      db.run(`CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        message TEXT,
        is_admin BOOLEAN DEFAULT 0,
        admin_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error('❌ Ошибка создания таблицы chats:', err.message);
        } else {
          console.log('✅ Таблица chats готова');
        }
      });

      // Создаем главного администратора
      db.get('SELECT * FROM users WHERE telegram_id = "8036875641"', (err, row) => {
        if (err) {
          console.error('❌ Ошибка проверки администратора:', err.message);
        } else if (!row) {
          db.run(`INSERT INTO users (telegram_id, username, first_name, is_admin) 
                  VALUES ('8036875641', '@LinkGoldAdmin', 'Администратор', 1)`, 
            (err) => {
              if (err) {
                console.error('❌ Ошибка создания администратора:', err.message);
              } else {
                console.log('✅ Главный администратор создан');
              }
            });
        } else {
          console.log('✅ Администратор уже существует');
        }
      });

      // Добавляем демо-задания если их нет
      db.get('SELECT COUNT(*) as count FROM tasks', (err, row) => {
        if (err) {
          console.error('❌ Ошибка проверки заданий:', err.message);
        } else if (row.count === 0) {
          const demoTasks = [
            ['Подписка на Telegram канал', 'subscribe', 15, 'Подпишитесь на наш Telegram канал', '5 мин', 'https://t.me/linkgold_channel', '8036875641'],
            ['Просмотр YouTube видео', 'view', 10, 'Посмотрите видео на YouTube до конца', '10 мин', 'https://youtube.com', '8036875641'],
            ['Комментарий в группе', 'comment', 20, 'Оставьте комментарий в указанной группе', '7 мин', 'https://t.me/test_group', '8036875641'],
            ['Репост в Telegram', 'repost', 25, 'Сделайте репост сообщения', '3 мин', 'https://t.me/linkgold_news', '8036875641']
          ];
          
          const stmt = db.prepare(`INSERT INTO tasks (title, category, price, description, time, link, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)`);
          
          demoTasks.forEach((task, index) => {
            stmt.run(task, (err) => {
              if (err) {
                console.error('❌ Ошибка добавления задания:', err.message);
              } else if (index === demoTasks.length - 1) {
                console.log('✅ Демо-задания добавлены');
                resolve();
              }
            });
          });
          
          stmt.finalize();
        } else {
          console.log('✅ Задания уже существуют');
          resolve();
        }
      });
    });
  });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Логирование запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Middleware аутентификации
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

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true,
    message: 'Сервер LinkGold работает',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    version: '1.0.0'
  });
});

// Тестовый endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true,
    message: 'Тестовый endpoint работает',
    data: {
      port: PORT,
      environment: NODE_ENV,
      database: 'SQLite'
    }
  });
});

// Аутентификация через Telegram
app.post('/api/auth/telegram', (req, res) => {
  try {
    const { telegramId, username, firstName } = req.body;

    if (!telegramId) {
      return res.status(400).json({ success: false, error: 'Telegram ID обязателен' });
    }

    // Проверяем существующего пользователя
    db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId], (err, user) => {
      if (err) {
        console.error('❌ Ошибка БД:', err.message);
        return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
      }

      if (user) {
        // Обновляем данные пользователя
        if (user.username !== username || user.first_name !== firstName) {
          db.run('UPDATE users SET username = ?, first_name = ? WHERE telegram_id = ?', 
            [username, firstName, telegramId]);
        }
        
        const token = jwt.sign(
          { 
            telegramId: user.telegram_id, 
            username: user.username,
            isAdmin: user.is_admin === 1
          },
          JWT_SECRET,
          { expiresIn: '24h' }
        );

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
        db.run(
          'INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)',
          [telegramId, username || `user_${telegramId}`, firstName || 'User'],
          function(err) {
            if (err) {
              console.error('❌ Ошибка создания пользователя:', err.message);
              return res.status(500).json({ success: false, error: 'Ошибка создания пользователя' });
            }

            const token = jwt.sign(
              { 
                telegramId, 
                username: username || `user_${telegramId}`,
                isAdmin: false
              },
              JWT_SECRET,
              { expiresIn: '24h' }
            );

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
  } catch (error) {
    console.error('❌ Ошибка аутентификации:', error);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// Получение заданий
app.get('/api/tasks', authenticateToken, (req, res) => {
  try {
    const { search, category } = req.query;
    let query = 'SELECT * FROM tasks WHERE status = "active"';
    const params = [];

    if (search) {
      query += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY created_at DESC';

    db.all(query, params, (err, tasks) => {
      if (err) {
        console.error('❌ Ошибка получения заданий:', err.message);
        return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
      }
      res.json({ success: true, tasks: tasks || [] });
    });
  } catch (error) {
    console.error('❌ Ошибка получения заданий:', error);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// Запуск задания
app.post('/api/tasks/start', authenticateToken, (req, res) => {
  try {
    const { taskId } = req.body;

    if (!taskId) {
      return res.status(400).json({ success: false, error: 'ID задания обязательно' });
    }

    // Проверяем, не выполняет ли пользователь уже это задание
    db.get('SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ? AND status = "pending"', 
      [req.user.telegramId, taskId], (err, existingTask) => {
        if (err) {
          console.error('❌ Ошибка проверки задания:', err.message);
          return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
        }

        if (existingTask) {
          return res.status(400).json({ success: false, error: 'Вы уже выполняете это задание' });
        }

        // Создаем запись о начале выполнения задания
        db.run('INSERT INTO user_tasks (user_id, task_id) VALUES (?, ?)',
          [req.user.telegramId, taskId], function(err) {
            if (err) {
              console.error('❌ Ошибка начала задания:', err.message);
              return res.status(500).json({ success: false, error: 'Ошибка начала задания' });
            }

            // Обновляем счетчик активных заданий
            db.run('UPDATE users SET active_tasks = active_tasks + 1 WHERE telegram_id = ?', 
              [req.user.telegramId]);

            res.json({ success: true, message: 'Задание начато' });
          });
      });
  } catch (error) {
    console.error('❌ Ошибка начала задания:', error);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// Получение заданий пользователя
app.get('/api/user/tasks', authenticateToken, (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT ut.*, t.title, t.price, t.category 
      FROM user_tasks ut 
      JOIN tasks t ON ut.task_id = t.id 
      WHERE ut.user_id = ?
    `;
    const params = [req.user.telegramId];

    if (status) {
      query += ' AND ut.status = ?';
      params.push(status);
    }

    query += ' ORDER BY ut.submitted_at DESC';

    db.all(query, params, (err, tasks) => {
      if (err) {
        console.error('❌ Ошибка получения заданий пользователя:', err.message);
        return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
      }
      res.json({ success: true, tasks: tasks || [] });
    });
  } catch (error) {
    console.error('❌ Ошибка получения заданий пользователя:', error);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// Чат поддержки - получение сообщений
app.get('/api/chat/messages', authenticateToken, (req, res) => {
  try {
    db.all(
      `SELECT c.*, u.username 
       FROM chats c 
       LEFT JOIN users u ON c.admin_id = u.telegram_id 
       WHERE c.user_id = ? 
       ORDER BY c.created_at ASC`,
      [req.user.telegramId],
      (err, messages) => {
        if (err) {
          console.error('❌ Ошибка получения сообщений:', err.message);
          return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
        }
        res.json({ success: true, messages: messages || [] });
      }
    );
  } catch (error) {
    console.error('❌ Ошибка получения сообщений:', error);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// Чат поддержки - отправка сообщения
app.post('/api/chat/messages', authenticateToken, (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Сообщение не может быть пустым' });
    }

    db.run(
      'INSERT INTO chats (user_id, message, is_admin) VALUES (?, ?, 0)',
      [req.user.telegramId, message.trim()],
      function(err) {
        if (err) {
          console.error('❌ Ошибка отправки сообщения:', err.message);
          return res.status(500).json({ success: false, error: 'Ошибка отправки сообщения' });
        }

        res.json({ success: true, message: 'Сообщение отправлено' });
      }
    );
  } catch (error) {
    console.error('❌ Ошибка отправки сообщения:', error);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// Получение данных пользователя
app.get('/api/user/profile', authenticateToken, (req, res) => {
  try {
    db.get('SELECT * FROM users WHERE telegram_id = ?', [req.user.telegramId], (err, user) => {
      if (err) {
        console.error('❌ Ошибка получения профиля:', err.message);
        return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
      }

      if (!user) {
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
  } catch (error) {
    console.error('❌ Ошибка получения профиля:', error);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

// SPA роут
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Страница не найдена' });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('❌ Необработанная ошибка:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Внутренняя ошибка сервера',
    ...(NODE_ENV === 'development' && { details: err.message })
  });
});

// Запуск сервера
async function startServer() {
  try {
    console.log('🚀 Инициализация сервера LinkGold...');
    
    await initializeDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log('================================');
      console.log('✅ Сервер успешно запущен!');
      console.log(`📍 Порт: ${PORT}`);
      console.log(`🌍 Окружение: ${NODE_ENV}`);
      console.log(`📊 База данных: ${dbPath}`);
      console.log(`🔗 Health check: /api/health`);
      console.log('================================');
    });
  } catch (error) {
    console.error('❌ Ошибка запуска сервера:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Завершение работы сервера...');
  db.close((err) => {
    if (err) {
      console.error('❌ Ошибка закрытия БД:', err.message);
    } else {
      console.log('✅ База данных закрыта');
    }
    process.exit(0);
  });
});

// Запуск
startServer();