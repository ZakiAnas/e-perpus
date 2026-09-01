const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

// Memastikan folder uploads tersedia agar server tidak crash saat pertama kali dijalankan
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Konfigurasi CORS sekali di paling atas
app.use(cors({
  origin: 'https://e-perpus-frontend-pupips8xj-zakianas.vercel.app', // Ganti dengan URL frontend kamu
  credentials: true
}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Storage Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-')) // Menghindari spasi pada nama file
});
const upload = multer({ storage });

// ================= AUTH API ================= //

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ status: 'error', message: 'Semua kolom wajib diisi!' });
    }

    const userExists = await prisma.user.findUnique({ where: { email } });
    if (userExists) {
      return res.status(400).json({ status: 'error', message: 'Email sudah terdaftar!' });
    }

    // Enkripsi password sebelum disimpan ke database
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: { 
        name, 
        email, 
        password: hashedPassword, 
        role: role || 'MEMBER' 
      }
    });

    // Jangan kembalikan password di response
    delete newUser.password;
    res.json({ status: 'success', data: newUser });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(400).json({ status: 'error', message: 'Email atau password salah!' });
    }

    // Komparasi password input dengan password hash di database
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ status: 'error', message: 'Email atau password salah!' });
    }

    delete user.password; // Amankan data response
    res.json({ status: 'success', data: { user } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ================= STATS API ================= //

app.get('/api/stats', async (req, res) => {
  try {
    const totalBooks = await prisma.book.count();
    const totalUsers = await prisma.user.count();
    const activeBorrowings = await prisma.borrowing.count({ where: { status: 'BORROWED' } });

    res.json({
      status: 'success',
      data: { totalBooks, totalUsers, activeBorrowings }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ================= BOOK API ================= //

app.get('/api/books', async (req, res) => {
  try {
    const { q, category } = req.query;
    let whereClause = {};

    if (q) {
      whereClause.OR = [
        { title: { contains: q } }, // Jika pakai PostgreSQL, tambahkan mode: 'insensitive' di sini
        { author: { contains: q } }
      ];
    }

    if (category && category !== 'Semua') {
      whereClause.category = category;
    }

    const books = await prisma.book.findMany({
      where: whereClause,
      orderBy: { id: 'desc' }
    });

    res.json({ status: 'success', data: books });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/books', upload.single('file'), async (req, res) => {
  try {
    const { title, author, category, isbn, stock } = req.body;
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const newBook = await prisma.book.create({
      data: {
        title,
        author,
        category: category || 'Umum',
        isbn: isbn || '-',
        stock: parseInt(stock) || 1,
        fileUrl
      }
    });

    res.json({ status: 'success', data: newBook });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.delete('/api/books/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.book.delete({ where: { id: parseInt(id) } });
    res.json({ status: 'success', message: 'Buku berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ================= BORROWING API ================= //

app.get('/api/borrowings', async (req, res) => {
  try {
    const borrowings = await prisma.borrowing.findMany({
      include: { 
        user: { select: { id: true, name: true, email: true } }, // Jangan tarik password user di relasi
        book: true 
      },
      orderBy: { id: 'desc' }
    });
    res.json({ status: 'success', data: borrowings });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/borrow', async (req, res) => {
  try {
    const { userId, bookId } = req.body;

    const book = await prisma.book.findUnique({ where: { id: parseInt(bookId) } });
    if (!book || book.stock <= 0) {
      return res.status(400).json({ status: 'error', message: 'Stok buku ini sedang habis!' });
    }

    // Menggunakan transaction memastikan data sinkron (stok berkurang DAN pinjaman tercatat bersamaan)
    const [borrow] = await prisma.$transaction([
      prisma.borrowing.create({
        data: {
          userId: parseInt(userId),
          bookId: parseInt(bookId),
          status: 'BORROWED'
        }
      }),
      prisma.book.update({
        where: { id: parseInt(bookId) },
        data: { stock: book.stock - 1 }
      })
    ]);

    res.json({ status: 'success', data: borrow, message: 'Buku berhasil dipinjam!' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/return', async (req, res) => {
  try {
    const { borrowId } = req.body;

    const borrow = await prisma.borrowing.findUnique({ where: { id: parseInt(borrowId) } });
    if (!borrow || borrow.status === 'RETURNED') {
      return res.status(400).json({ status: 'error', message: 'Buku sudah dikembalikan sebelumnya atau tidak ditemukan!' });
    }

    // Sama seperti peminjaman, gunakan transaction agar update status & stok tidak belang
    await prisma.$transaction([
      prisma.borrowing.update({
        where: { id: parseInt(borrowId) },
        data: { status: 'RETURNED' }
      }),
      prisma.book.update({
        where: { id: borrow.bookId },
        data: { stock: { increment: 1 } }
      })
    ]);

    res.json({ status: 'success', message: 'Buku berhasil dikembalikan!' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({ 
      select: { id: true, name: true, email: true, role: true }, // Filter password dari response
      orderBy: { id: 'desc' } 
    });
    res.json({ status: 'success', data: users });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`KI-Z Library API aktif di http://localhost:${PORT}`));

module.exports = app;