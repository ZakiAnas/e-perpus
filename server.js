const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const Module = require('module');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Storage Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
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

    const newUser = await prisma.user.create({
      data: { name, email, password, role: role || 'MEMBER' }
    });

    res.json({ status: 'success', data: newUser });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.password !== password) {
      return res.status(400).json({ status: 'error', message: 'Email atau password salah!' });
    }

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
        { title: { contains: q } },
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
      include: { user: true, book: true },
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

    // Kurangi stok
    await prisma.book.update({
      where: { id: parseInt(bookId) },
      data: { stock: book.stock - 1 }
    });

    const borrow = await prisma.borrowing.create({
      data: {
        userId: parseInt(userId),
        bookId: parseInt(bookId),
        status: 'BORROWED'
      }
    });

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
      return res.status(400).json({ status: 'error', message: 'Buku sudah dikembalikan sebelumnya!' });
    }

    await prisma.borrowing.update({
      where: { id: parseInt(borrowId) },
      data: { status: 'RETURNED' }
    });

    await prisma.book.update({
      where: { id: borrow.bookId },
      data: { stock: { increment: 1 } }
    });

    res.json({ status: 'success', message: 'Buku berhasil dikembalikan!' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { id: 'desc' } });
    res.json({ status: 'success', data: users });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

const PORT = 5000;
app.listen(PORT, () => console.log(` KI-Z Library API aktif di http://localhost:${PORT}`));

module.exports = app;