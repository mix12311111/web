const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

// --- 1. KHỞI TẠO FIREBASE ADMIN ---
// CHÚ Ý: Bạn cần tải file serviceAccountKey.json từ Firebase Console 
// (Project Settings -> Service Accounts -> Generate new private key)
// và đặt nó vào cùng thư mục với file reading_server.js này.
try {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("✅ Đã kết nối Firebase Admin thành công.");
} catch (error) {
  console.warn("⚠️ CẢNH BÁO: Chưa tìm thấy file serviceAccountKey.json. Vui lòng tải về từ Firebase Console.");
}

const db = admin.apps.length ? admin.firestore() : null;
const app = express();

app.use(express.json());
// Bật CORS để cho phép Frontend (ví dụ chạy trên cổng khác) gọi API tới Backend
app.use(cors());

// --- 2. DỮ LIỆU BÀI VIẾT (MOCK TẠM THỜI) ---
// Thực tế bạn có thể lưu bảng Articles này trên Firestore luôn.
const articles = {
  'article_1': {
    id: 'article_1',
    title: 'Khám phá vũ trụ: Lỗ đen siêu khối lượng lớn nhất từng được biết đến',
    sapo: 'Các nhà khoa học vừa phát hiện ra một lỗ đen siêu khối lượng ở trung tâm thiên hà xa xôi. Đây là bước tiến quan trọng trong thiên văn học...',
    content: 'Chi tiết về lỗ đen này cho thấy nó có khối lượng gấp hàng tỷ lần Mặt Trời. Sự hình thành của nó vẫn là một bí ẩn, tuy nhiên các dữ liệu từ kính viễn vọng không gian James Webb đã cung cấp những manh mối vô cùng quan trọng. (Đây là phần nội dung chuyên sâu rất dài, chỉ dành cho tài khoản VIP...)'
  }
};

// --- 3. MIDDLEWARE XÁC THỰC BẰNG FIREBASE ---
const firebaseAuthMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Thiếu Token' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    if (!admin.apps.length) {
      return res.status(500).json({ success: false, error: 'Firebase Admin chưa được khởi tạo. Kiểm tra serviceAccountKey.' });
    }

    // Xác thực token với Firebase
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    
    // Lấy thông tin user từ Firestore
    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();
    
    let userData = {};
    if (!doc.exists) {
      // Nếu user chưa có trong Database, tạo mới với điểm 0 và không phải VIP
      userData = { 
        id: uid, 
        email: decodedToken.email, 
        name: decodedToken.name || 'Người dùng mới',
        isVip: false, 
        points: 0 
      };
      await userRef.set(userData);
    } else {
      userData = doc.data();
    }

    req.user = userData;
    req.userRef = userRef; // Lưu lại reference để tiện update DB ở API sau
    next();
  } catch (error) {
    console.error('Lỗi xác thực Token:', error);
    return res.status(401).json({ success: false, error: 'Unauthorized: Token không hợp lệ hoặc đã hết hạn' });
  }
};

// --- 4. API ENDPOINTS ---

/**
 * GET /api/articles/:id
 * Phân quyền nội dung: Free chỉ xem sapo, VIP xem toàn bộ
 */
app.get('/api/articles/:id', firebaseAuthMiddleware, async (req, res) => {
  try {
    const articleId = req.params.id;
    const article = articles[articleId];
    
    if (!article) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy bài viết' });
    }

    // Nếu User là VIP, trả về toàn bộ nội dung
    if (req.user.isVip) {
      return res.json({
        success: true,
        data: {
          id: article.id,
          title: article.title,
          sapo: article.sapo,
          content: article.content, // Trả full nội dung
          isPremiumContentUnlocked: true,
          currentUserPoints: req.user.points
        }
      });
    } 

    // Nếu User Free, ẩn nội dung chi tiết
    return res.json({
      success: true,
      data: {
        id: article.id,
        title: article.title,
        sapo: article.sapo,
        content: null, // Không trả về nội dung chính
        isPremiumContentUnlocked: false,
        currentUserPoints: req.user.points
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: 'Lỗi Server' });
  }
});

/**
 * POST /api/user/add-points
 * Cộng điểm sau khi User đọc đủ thời gian
 */
app.post('/api/user/add-points', firebaseAuthMiddleware, async (req, res) => {
  try {
    const { readingTime } = req.body;
    
    // Validate: Chỉ cộng điểm nếu thời gian đọc thực tế >= 5 phút (300 giây)
    if (!readingTime || readingTime < 300) {
      return res.status(400).json({ 
        success: false, 
        error: 'Chưa đủ thời gian đọc yêu cầu để nhận thưởng.' 
      });
    }

    const basePoints = 50;
    const rewardPoints = req.user.isVip ? basePoints * 2 : basePoints;
    
    // Cập nhật Database Firestore an toàn sử dụng FieldValue.increment
    // Cách này giúp tránh lỗi xung đột dữ liệu khi nhiều request cùng lúc
    await req.userRef.update({
      points: admin.firestore.FieldValue.increment(rewardPoints)
    });

    res.json({
      success: true,
      message: 'Cộng điểm thành công!',
      data: {
        addedPoints: rewardPoints,
        totalPoints: req.user.points + rewardPoints // Điểm mới
      }
    });
  } catch (error) {
    console.error('Lỗi khi cộng điểm:', error);
    res.status(500).json({ success: false, error: 'Lỗi Server' });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server Backend (Firebase Auth) đang chạy tại port ${PORT}`));
