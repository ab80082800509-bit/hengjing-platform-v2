import './globals.css';

export const metadata = {
  title: '買個PAY服 - 0 抽成垂直媒合平台',
  description: '高安全、0 抽成專業垂直媒合平台',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}