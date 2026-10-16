'use client';

import { useState } from 'react';

export default function ChatPage() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [warningMsg, setWarningMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;

    setLoading(true);
    setWarningMsg(null);
    setSuccessMsg(null);

    try {
      // 呼叫我們剛剛寫好的 API (內含自動容錯)
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: 'user_1',
          receiver_id: 'user_2',
          content: content,
        }),
      });

      const data = await res.json();

      if (data.success) {
        if (data.warning) {
          setWarningMsg(data.warning);
        } else {
          setSuccessMsg('訊息發送成功！');
        }
        setContent('');
      } else {
        alert('發送失敗: ' + data.error);
      }
    } catch (err) {
      console.error('發送錯誤:', err);
      alert('發送失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '50px auto', padding: '20px', background: '#222', color: '#fff', borderRadius: '8px' }}>
      <h2>買個PAY服 - 安全即時聊天室</h2>
      
      <div style={{ height: '300px', background: '#111', border: '1px solid #444', borderRadius: '4px', padding: '10px', marginBottom: '15px', overflowY: 'auto' }}>
        <p style={{ color: '#888' }}>聊天記錄載入區...</p>
      </div>

      {warningMsg && (
        <div style={{ background: '#f59e0b', color: '#000', padding: '12px', borderRadius: '4px', marginBottom: '10px', fontWeight: 'bold' }}>
          {warningMsg}
        </div>
      )}

      {successMsg && (
        <div style={{ background: '#10b981', color: '#fff', padding: '10px', borderRadius: '4px', marginBottom: '10px' }}>
          {successMsg}
        </div>
      )}

      <form onSubmit={handleSend} style={{ display: 'flex', gap: '10px' }}>
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="輸入訊息（例如：轉帳、加賴）..."
          style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #555', background: '#333', color: '#fff' }}
        />
        <button 
          type="submit" 
          disabled={loading}
          style={{ padding: '10px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          {loading ? '發送中...' : '發送'}
        </button>
      </form>
    </div>
  );
}