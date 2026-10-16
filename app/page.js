'use client';
import { useState } from 'react';

export default function Home() {
  const [role, setRole] = useState('client'); // 'client' 買家/業主 或 'contractor' 服務商/師傅
  const [loading, setLoading] = useState(false);
  const [storeInfo, setStoreInfo] = useState(null);

  // 呼叫後端綠界物流地圖 API
  const handleOpenMap = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/logistic/map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientBackURL: window.location.origin }),
      });
      const data = await res.json();
      
      if (data.success) {
        console.log('綠界參數準備就緒：', data.params);
        alert('成功連線至綠界物流地圖伺服器！');
      } else {
        alert('載入物流地圖失敗');
      }
    } catch (err) {
      console.error(err);
      alert('無法開啟物流地圖');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col justify-between">
      {/* 頂部導覽列 */}
      <header className="flex justify-between items-center p-6 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <span className="text-xl font-bold text-cyan-400">買個PAY服</span>
          <span className="text-xs bg-cyan-900/50 text-cyan-300 px-2 py-1 rounded border border-cyan-700">0 抽成垂直媒合平台</span>
        </div>
        <div className="space-x-4">
          <button 
            onClick={() => alert('登入功能建置中，敬請期待！')}
            className="text-sm text-slate-300 hover:text-white px-4 py-2"
          >
            登入
          </button>
          <button 
            onClick={() => alert('訂閱方案 NT$ 599/月 即將上線！')}
            className="text-sm bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg font-medium transition"
          >
            立即訂閱 (NT$ 599/月)
          </button>
        </div>
      </header>

      {/* 網站主視覺 Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 py-16">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6">
          高安全、<span className="text-cyan-400">0 抽成</span>專業垂直媒合平台
        </h1>
        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mb-10">
          免除中間商剝削，雙方直接對接。月費僅需 NT$ 599，享受最高效、透明的媒合服務。
        </p>

        {/* 身分切換按鈕 */}
        <div className="bg-slate-800 p-1.5 rounded-xl flex mb-8 border border-slate-700">
          <button
            onClick={() => setRole('client')}
            className={`px-6 py-2.5 rounded-lg font-medium transition ${role === 'client' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
          >
            我是尋求服務者
          </button>
          <button
            onClick={() => setRole('contractor')}
            className={`px-6 py-2.5 rounded-lg font-medium transition ${role === 'contractor' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
          >
            我是接案專業戶
          </button>
        </div>

        {/* 動態表單/按鈕區 */}
        <div className="bg-slate-800/80 border border-slate-700 p-8 rounded-2xl max-w-md w-full shadow-xl">
          {role === 'client' ? (
            <div>
              <h3 className="text-xl font-bold mb-4 text-cyan-300">發布您的需求</h3>
              <p className="text-sm text-slate-400 mb-6">快速填寫您的需求，即刻對接優質專業人才。</p>
              
              {/* 超商取貨門市選擇區塊 */}
              <div className="mb-4 p-3 bg-slate-900/60 rounded-lg border border-slate-700 text-left">
                <span className="text-xs text-slate-400 block mb-1">超商寄送設定</span>
                {storeInfo ? (
                  <div className="text-xs text-emerald-400">
                    已選門市：{storeInfo.name}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">尚未選擇超商門市</div>
                )}
              </div>

              <button 
                onClick={handleOpenMap}
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition mb-3 disabled:opacity-50"
              >
                {loading ? '連線中...' : '選擇超商取貨門市 (7-11 / 全家)'}
              </button>

              <button 
                onClick={() => alert('即將開放需求發布表單！')}
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-xl transition"
              >
                立即免費發布需求
              </button>
            </div>
          ) : (
            <div>
              <h3 className="text-xl font-bold mb-4 text-cyan-300">專業人士入駐</h3>
              <p className="text-sm text-slate-400 mb-6">每月僅需 NT$ 599 訂閱費，接案完全 0 抽成，利潤全數保留！</p>
              <button 
                onClick={() => alert('入駐訂閱系統建置中！')}
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-xl transition"
              >
                立即加入訂閱 (NT$ 599/月)
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 底部資訊 */}
      <footer className="text-center py-6 text-xs text-slate-500 border-t border-slate-800">
        © 2026 買個PAY服 版權所有. All Rights Reserved.
      </footer>
    </main>
  );
}