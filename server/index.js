const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'pleasechangethisdefaultsecret';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'vpsData.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SALT_ROUNDS = 10;

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 确保数据文件存在
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '{}', 'utf-8');
}

// 确保用户文件存在并使用哈希密码
if (!fs.existsSync(USERS_FILE)) {
  const defaultUsername = "shannon2206";
  const defaultPassword = "xetwuh-supqyw-7xidQy"; 
  bcrypt.hash(defaultPassword, SALT_ROUNDS, (err, hashedPassword) => {
    if (err) {
      console.error("Error hashing initial password:", err);
      process.exit(1); 
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify({
      "username": defaultUsername,
      "passwordHash": hashedPassword 
    }), 'utf-8');
    console.log('Users file created with hashed password.');
  });
} else {
  // Optional: Check if existing users.json has plain password and re-hash if needed
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    if (users && users.password && !users.passwordHash) {
      console.log("Found plain password in users.json, attempting to re-hash...");
      bcrypt.hash(users.password, SALT_ROUNDS, (err, hashedPassword) => {
        if (err) {
          console.error("Error re-hashing password from users.json:", err);
        } else {
          fs.writeFileSync(USERS_FILE, JSON.stringify({
            "username": users.username,
            "passwordHash": hashedPassword
          }), 'utf-8');
          console.log('Re-hashed password in users.json successfully.');
        }
      });
    }
  } catch (e) {
    console.error("Error reading or parsing users.json for re-hash check:", e);
  }
}

app.use(cors());
app.use(bodyParser.json());

// Helper: 读取 JSON 文件
function readJSON(file) {
  if (!fs.existsSync(file)) return {};
  const content = fs.readFileSync(file, 'utf-8');
  return JSON.parse(content || '{}');
}

// Helper: 写入 JSON 文件
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// 验证 JWT Token 中间件
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: '未提供认证令牌' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '令牌格式无效' });

  try {
    const verified = jwt.verify(token, SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(401).json({ error: '令牌无效或已过期' });
  }
}

// 管理员登录
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const usersData = readJSON(USERS_FILE);

  if (!usersData.username || !usersData.passwordHash) {
    console.error('User data or password hash is missing in users.json');
    return res.status(500).json({ error: '用户账户配置错误，请联系管理员' });
  }

  if (usersData.username === username) {
    try {
      const match = await bcrypt.compare(password, usersData.passwordHash);
      if (match) {
        const token = jwt.sign({ username: usersData.username }, SECRET, { expiresIn: '24h' });
        res.json({ token });
      } else {
        res.status(401).json({ error: '用户名或密码错误' });
      }
    } catch (bcryptErr) {
      console.error("Error during password comparison:", bcryptErr);
      res.status(500).json({ error: '登录过程中发生内部错误' });
    }
  } else {
    res.status(401).json({ error: '用户名或密码错误' });
  }
});

// 获取所有 VPS 数据
app.get('/api/vps', (req, res) => {
  const vpsData = readJSON(DATA_FILE);
  res.json(vpsData);
});

// 获取指定分类的 VPS 列表
app.get('/api/vps/:category', (req, res) => {
  const vpsData = readJSON(DATA_FILE);
  const { category } = req.params;
  
  if (!vpsData[category]) {
    return res.status(404).json({ error: '分类不存在' });
  }
  
  res.json(vpsData[category]);
});

// 添加 VPS
app.post('/api/vps/:category', verifyToken, (req, res) => {
  const vpsData = readJSON(DATA_FILE);
  const { category } = req.params;
  const vps = req.body;
  
  if (!vpsData[category]) {
    vpsData[category] = [];
  }
  
  vpsData[category].push(vps);
  writeJSON(DATA_FILE, vpsData);
  
  res.status(201).json({ message: 'VPS 添加成功', vps });
});

// 编辑 VPS
app.put('/api/vps/:category/:index', verifyToken, (req, res) => {
  const vpsData = readJSON(DATA_FILE);
  const { category, index } = req.params;
  const vps = req.body;
  
  if (!vpsData[category]) {
    return res.status(404).json({ error: '分类不存在' });
  }
  
  const idx = parseInt(index);
  if (isNaN(idx) || idx < 0 || idx >= vpsData[category].length) {
    return res.status(404).json({ error: 'VPS 索引无效' });
  }
  
  vpsData[category][idx] = vps;
  writeJSON(DATA_FILE, vpsData);
  
  res.json({ message: 'VPS 更新成功', vps });
});

// 删除 VPS
app.delete('/api/vps/:category/:index', verifyToken, (req, res) => {
  const vpsData = readJSON(DATA_FILE);
  const { category, index } = req.params;
  
  if (!vpsData[category]) {
    return res.status(404).json({ error: '分类不存在' });
  }
  
  const idx = parseInt(index);
  if (isNaN(idx) || idx < 0 || idx >= vpsData[category].length) {
    return res.status(404).json({ error: 'VPS 索引无效' });
  }
  
  const deleted = vpsData[category].splice(idx, 1)[0];
  writeJSON(DATA_FILE, vpsData);
  
  res.json({ message: 'VPS 删除成功', deleted });
});

app.listen(PORT, () => {
  console.log(`后端服务已启动，监听端口: ${PORT}`);
}); 