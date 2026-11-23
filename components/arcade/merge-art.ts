/**
 * 合成小舖的原創向量素材，來源是 design/merge-shop-visual-proposal/index.html。
 * 只有靜態圖形，沒有任何會員資料。
 */
export const MERGE_ART_SVG = String.raw`<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
<defs>
  <linearGradient id="gLeaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b2ea72"/><stop offset="1" stop-color="#3f9b35"/></linearGradient>
  <linearGradient id="gLeaf2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4f59a"/><stop offset="1" stop-color="#5cb847"/></linearGradient>
  <linearGradient id="gCream" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1dcbc"/></linearGradient>
  <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6b0"/><stop offset=".45" stop-color="#ffd23f"/><stop offset="1" stop-color="#e59a0c"/></linearGradient>
  <linearGradient id="gCeladon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0f6e3"/><stop offset="1" stop-color="#7fbf96"/></linearGradient>
  <linearGradient id="gMilk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8e0bb"/><stop offset="1" stop-color="#c88b52"/></linearGradient>
  <linearGradient id="gPink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe6ee"/><stop offset="1" stop-color="#f58fab"/></linearGradient>
  <linearGradient id="gRed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a76"/><stop offset="1" stop-color="#d93a2b"/></linearGradient>
  <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bde7ff"/><stop offset="1" stop-color="#4a98e8"/></linearGradient>
  <linearGradient id="gKraft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2cc95"/><stop offset="1" stop-color="#c08347"/></linearGradient>
  <linearGradient id="gPeach" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe8d4"/><stop offset="1" stop-color="#ffb68a"/></linearGradient>
  <linearGradient id="gOrange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb46b"/><stop offset="1" stop-color="#ea580c"/></linearGradient>
  <linearGradient id="gBrown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbd998"/><stop offset="1" stop-color="#d08a34"/></linearGradient>
  <linearGradient id="gWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfa262"/><stop offset="1" stop-color="#a86a32"/></linearGradient>
  <linearGradient id="gWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff5e3"/><stop offset="1" stop-color="#ffdcb2"/></linearGradient>
  <linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9e0ff"/><stop offset="1" stop-color="#fff1d0"/></linearGradient>
  <radialGradient id="gGlow"><stop offset="0" stop-color="#fff6b0" stop-opacity=".95"/><stop offset=".55" stop-color="#ffd23f" stop-opacity=".35"/><stop offset="1" stop-color="#ffd23f" stop-opacity="0"/></radialGradient>
  <pattern id="pWall" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M22 14 L26 22 L22 30 L18 22Z" fill="#f8cf9c" opacity=".55"/></pattern>
  <pattern id="pPlank" width="48" height="80" patternUnits="userSpaceOnUse"><rect width="48" height="80" fill="#e3a868"/><path d="M0 0V80" stroke="#c98a4b" stroke-width="4"/><path d="M14 20 q6 4 12 0 M28 52 q6 4 12 0" stroke="#d29454" stroke-width="2" fill="none"/></pattern>
  <pattern id="pAwning" width="80" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#f97316"/><rect x="40" width="40" height="40" fill="#fff7ea"/></pattern>
  <pattern id="pScallop" width="80" height="22" patternUnits="userSpaceOnUse"><path d="M0 0H40C40 12 31 20 20 20C9 20 0 12 0 0Z" fill="#f97316" stroke="#4a2c1a" stroke-width="3"/><path d="M40 0H80C80 12 71 20 60 20C49 20 40 12 40 0Z" fill="#fff7ea" stroke="#4a2c1a" stroke-width="3"/></pattern>
  <clipPath id="cWin"><circle cx="330" cy="140" r="66"/></clipPath>
</defs>

<!-- 小特效 -->
<symbol id="fx-spark" viewBox="0 0 20 20"><path d="M10 0L12.5 7.5L20 10L12.5 12.5L10 20L7.5 12.5L0 10L7.5 7.5Z" fill="#fff" stroke="#f59e0b" stroke-width="1.2"/></symbol>

<!-- ======== 茶飲線 ======== -->
<symbol id="it-tea-1" viewBox="0 0 100 100">
  <ellipse cx="50" cy="89" rx="28" ry="5" fill="#000" opacity=".13"/>
  <g stroke="#2e5a1c" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M46 84C20 78 12 46 30 16C54 30 64 62 46 84Z" fill="url(#gLeaf)"/>
    <path d="M46 84C40 62 38 42 30 18M40 56L28 50M42 68L31 66M37 42L31 35" fill="none" stroke-width="2.4"/>
    <path d="M52 86C78 84 90 58 79 28C58 40 46 62 52 86Z" fill="url(#gLeaf2)"/>
    <path d="M52 86C60 66 68 50 79 30M60 66L72 63M64 54L76 47" fill="none" stroke-width="2.4"/>
    <path d="M49 86C49 91 46 94 41 94" fill="none"/>
  </g>
  <path d="M26 36C27 29 29 24 31 21" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".75"/>
  <circle cx="70" cy="34" r="3" fill="#fff" opacity=".8"/>
  <use href="#fx-spark" x="78" y="10" width="14" height="14"/>
</symbol>

<symbol id="it-tea-2" viewBox="0 0 100 100">
  <ellipse cx="50" cy="91" rx="34" ry="4" fill="#000" opacity=".12"/>
  <g fill="none" stroke="#c9b29b" stroke-width="3.5" stroke-linecap="round" opacity=".65"><path d="M40 30c-6-6 6-10 0-18"/><path d="M58 30c-6-6 6-10 0-18"/></g>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <ellipse cx="50" cy="81" rx="37" ry="9" fill="url(#gCream)"/>
    <path d="M76 47C92 45 92 67 72 69" fill="none" stroke-width="10"/>
    <path d="M76 47C92 45 92 67 72 69" fill="none" stroke="#fbf1e0" stroke-width="4"/>
    <path d="M22 42H78C78 66 68 80 50 80C32 80 22 66 22 42Z" fill="url(#gCream)"/>
    <ellipse cx="50" cy="42" rx="28" ry="7" fill="#d7c45a"/>
    <path d="M25 56Q37 62 50 56T75 56" fill="none" stroke="#3d7fd6"/>
    <circle cx="50" cy="67" r="3.2" fill="#3d7fd6" stroke="none"/><circle cx="38" cy="65" r="2" fill="#3d7fd6" stroke="none"/><circle cx="62" cy="65" r="2" fill="#3d7fd6" stroke="none"/>
  </g>
  <ellipse cx="44" cy="41" rx="10" ry="2.5" fill="#fff" opacity=".6"/>
  <path d="M30 50C30 60 33 68 38 73" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".9"/>
</symbol>

<symbol id="it-tea-3" viewBox="0 0 100 100">
  <ellipse cx="50" cy="91" rx="32" ry="4.5" fill="#000" opacity=".13"/>
  <path d="M9 26c-4-4 4-8 0-12" stroke="#c9b29b" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M28 58C16 56 12 44 8 34L16 31C20 40 24 46 32 48Z" fill="url(#gCeladon)"/>
    <path d="M74 48C94 48 94 76 72 78" fill="none" stroke-width="10"/>
    <path d="M74 48C94 48 94 76 72 78" fill="none" stroke="#b5dfc0" stroke-width="4"/>
    <path d="M22 66C22 42 78 42 78 66C78 84 66 89 50 89C34 89 22 84 22 66Z" fill="url(#gCeladon)"/>
    <path d="M34 47C34 35 66 35 66 47Z" fill="#d9f2de"/>
    <ellipse cx="50" cy="47" rx="20" ry="4" fill="#c4e8cd"/>
    <circle cx="50" cy="31" r="5" fill="#f2b84b"/>
    <path d="M50 79C40 75 40 65 50 59C60 65 60 75 50 79Z" fill="#5cb847" stroke-width="2.2"/>
    <path d="M50 77V62" stroke-width="1.6"/>
  </g>
  <path d="M30 63C30 57 34 52 40 50" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".85"/>
</symbol>

<symbol id="it-tea-4" viewBox="0 0 100 100">
  <ellipse cx="50" cy="91" rx="24" ry="4" fill="#000" opacity=".13"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M58 3L65 5L58 33L51 31Z" fill="#f97316"/>
    <path d="M26 37H74L67 86C66 89 34 89 33 86Z" fill="url(#gMilk)"/>
    <g stroke="none" fill="#4a2c1a"><circle cx="40" cy="79" r="4.5"/><circle cx="50" cy="81" r="4.5"/><circle cx="60" cy="79" r="4.5"/><circle cx="45" cy="72.5" r="4.2"/><circle cx="55.5" cy="72.5" r="4.2"/></g>
    <g stroke="none" fill="#fff" opacity=".6"><circle cx="38.6" cy="77.6" r="1.3"/><circle cx="48.6" cy="79.6" r="1.3"/><circle cx="58.6" cy="77.6" r="1.3"/></g>
    <path d="M24 36C24 18 76 18 76 36Z" fill="#fff" fill-opacity=".72"/>
    <rect x="20" y="32" width="60" height="7" rx="3.5" fill="#fff"/>
    <circle cx="50" cy="56" r="10" fill="#fff"/>
    <circle cx="46" cy="55" r="1.8" fill="#4a2c1a" stroke="none"/><circle cx="54" cy="55" r="1.8" fill="#4a2c1a" stroke="none"/>
    <path d="M47 59Q50 62 53 59" stroke-width="1.8" fill="none"/>
  </g>
  <ellipse cx="43" cy="59" rx="2.2" ry="1.3" fill="#ff8aa0" opacity=".7"/><ellipse cx="57" cy="59" rx="2.2" ry="1.3" fill="#ff8aa0" opacity=".7"/>
  <path d="M31 45L35 80" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".55"/>
  <path d="M31 31C33 25 39 21 46 20" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".95"/>
</symbol>

<symbol id="it-tea-5" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="48" fill="url(#gGlow)"/>
  <ellipse cx="50" cy="91" rx="26" ry="4" fill="#000" opacity=".15"/>
  <g stroke="#7a4a06" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M22 36C8 36 8 56 26 56" fill="none" stroke-width="9"/><path d="M22 36C8 36 8 56 26 56" fill="none" stroke="#ffd23f" stroke-width="3"/>
    <path d="M78 36C92 36 92 56 74 56" fill="none" stroke-width="9"/><path d="M78 36C92 36 92 56 74 56" fill="none" stroke="#ffd23f" stroke-width="3"/>
    <ellipse cx="50" cy="85" rx="23" ry="6" fill="url(#gGold)"/>
    <path d="M44 63H56L58 82H42Z" fill="url(#gGold)"/>
    <ellipse cx="50" cy="71" rx="9" ry="4" fill="#ffd23f"/>
    <path d="M18 32H82C82 56 68 66 50 66C32 66 18 56 18 32Z" fill="url(#gGold)"/>
    <ellipse cx="50" cy="32" rx="32" ry="8" fill="#ffe57a"/>
    <ellipse cx="50" cy="33" rx="25" ry="5" fill="#bcd35a" stroke-width="2"/>
    <path d="M50 40L58 48L50 56L42 48Z" fill="#ef4444"/>
    <circle cx="30" cy="46" r="3" fill="#38bdf8" stroke-width="2"/><circle cx="70" cy="46" r="3" fill="#38bdf8" stroke-width="2"/>
  </g>
  <path d="M47 44L50 41" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M25 40C27 50 33 56 39 59" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".9"/>
  <use href="#fx-spark" x="78" y="6" width="18" height="18"/><use href="#fx-spark" x="6" y="62" width="12" height="12"/><use href="#fx-spark" x="84" y="66" width="10" height="10"/>
</symbol>

<!-- ======== 點心線 ======== -->
<symbol id="it-snack-1" viewBox="0 0 100 100">
  <ellipse cx="50" cy="91" rx="32" ry="4.5" fill="#000" opacity=".13"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M28 40C18 58 20 86 50 87C80 86 82 58 72 40Z" fill="#f7e8c8"/>
    <path d="M34 41C30 31 34 19 40 23C44 15 56 15 60 23C66 19 70 31 66 41Z" fill="#efdcb2"/>
    <path d="M30 41Q50 48 70 41" fill="none" stroke-width="9"/>
    <path d="M30 41Q50 48 70 41" fill="none" stroke="#e5483a" stroke-width="4"/>
    <circle cx="50" cy="65" r="13" fill="#fff"/>
    <g stroke-width="1.6" fill="#fff"><ellipse cx="22" cy="88" rx="3.5" ry="2.2"/><ellipse cx="30" cy="92" rx="3.5" ry="2.2"/><ellipse cx="77" cy="90" rx="3.5" ry="2.2"/></g>
  </g>
  <text x="50" y="71" text-anchor="middle" font-size="17" font-weight="900" fill="#c2410c" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">米</text>
  <g stroke="#dcc49a" stroke-width="2.2" stroke-linecap="round" opacity=".8"><path d="M31 57h4M66 59h4M33 78h4M63 80h4"/></g>
  <path d="M30 55C29 64 30 72 34 78" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".85"/>
</symbol>

<symbol id="it-snack-2" viewBox="0 0 100 100">
  <ellipse cx="50" cy="92" rx="30" ry="4" fill="#000" opacity=".13"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <circle cx="50" cy="37" r="12" fill="#fff4f7"/>
    <circle cx="35" cy="47" r="12.5" fill="url(#gPink)"/>
    <circle cx="65" cy="47" r="12.5" fill="#fffaf2"/>
    <path d="M38 85H62L60 92H40Z" fill="#f1dcbc"/>
    <path d="M13 52H87C87 74 72 86 50 86C28 86 13 74 13 52Z" fill="url(#gCream)"/>
    <path d="M21 64Q30 58 40 64T60 64T79 64" fill="none" stroke="#3d7fd6"/>
  </g>
  <g fill="#4a2c1a"><circle cx="31" cy="46" r="1.8"/><circle cx="39" cy="46" r="1.8"/><circle cx="61" cy="46" r="1.8"/><circle cx="69" cy="46" r="1.8"/></g>
  <g fill="#ff7a9a" opacity=".6"><ellipse cx="28" cy="50" rx="2.6" ry="1.5"/><ellipse cx="42" cy="50" rx="2.6" ry="1.5"/><ellipse cx="58" cy="50" rx="2.6" ry="1.5"/><ellipse cx="72" cy="50" rx="2.6" ry="1.5"/></g>
  <path d="M33 49.5Q35 51.5 37 49.5M63 49.5Q65 51.5 67 49.5" stroke="#4a2c1a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <g fill="#fff" opacity=".9"><circle cx="45" cy="31" r="2.5"/><circle cx="30" cy="40" r="2.3"/><circle cx="60" cy="40" r="2.3"/></g>
  <path d="M20 58C22 68 27 76 34 80" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".9"/>
</symbol>

<symbol id="it-snack-3" viewBox="0 0 100 100">
  <ellipse cx="50" cy="90" rx="38" ry="5" fill="#000" opacity=".12"/>
  <path d="M6 66C18 42 82 42 95 62C82 88 18 90 6 66Z" fill="url(#gLeaf)" stroke="#2e5a1c" stroke-width="3" stroke-linejoin="round"/>
  <path d="M10 66C40 60 70 60 92 62" stroke="#2e5a1c" stroke-width="2" fill="none"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <circle cx="27" cy="39" r="7" fill="#e5483a"/><circle cx="73" cy="39" r="7" fill="#e5483a"/>
    <circle cx="27" cy="75" r="7" fill="#e5483a"/><circle cx="73" cy="75" r="7" fill="#e5483a"/>
    <ellipse cx="88" cy="57" rx="9" ry="8" fill="#ec5a48"/>
    <path d="M15 57L6 53L8 62Z" fill="#e5483a"/>
    <ellipse cx="50" cy="57" rx="36" ry="25" fill="url(#gRed)"/>
    <path d="M50 41L62 49V64L50 72L38 64V49Z" fill="none" stroke="#a61e14" stroke-width="2.5"/>
    <path d="M50 41V33M62 49L76 43M62 64L77 70M50 72V81M38 64L23 70M38 49L24 43" stroke="#a61e14" stroke-width="2.5"/>
  </g>
  <text x="50" y="62" text-anchor="middle" font-size="12.5" font-weight="900" fill="#ffe1d6" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">壽</text>
  <circle cx="90.5" cy="55" r="1.8" fill="#4a2c1a"/>
  <path d="M24 50C28 42 36 37 45 35" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".65"/>
</symbol>

<symbol id="it-snack-4" viewBox="0 0 100 100">
  <ellipse cx="50" cy="91" rx="24" ry="4" fill="#000" opacity=".13"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M24 56H76L69 88H31Z" fill="#fff6e6"/>
    <path d="M36 58L39 86M48 58L49 86M60 58L59 86M70 58L66 86" stroke="#ecc9a0" stroke-width="2.4"/>
    <path d="M20 58C13 40 26 26 38 30C40 15 60 15 62 30C74 26 87 40 80 58Z" fill="url(#gPink)"/>
    <path d="M50 21L50 41M38 32L44 46M62 32L56 46" stroke="#d64f78" stroke-width="2.6" fill="none"/>
  </g>
  <circle cx="50" cy="51" r="4" fill="#e11d48"/>
  <g fill="#4a2c1a"><circle cx="43" cy="70" r="2.3"/><circle cx="57" cy="70" r="2.3"/></g>
  <path d="M47 75Q50 78 53 75" stroke="#4a2c1a" stroke-width="2" fill="none" stroke-linecap="round"/>
  <g fill="#ff8aa0" opacity=".6"><ellipse cx="38" cy="75" rx="3" ry="1.8"/><ellipse cx="62" cy="75" rx="3" ry="1.8"/></g>
  <path d="M27 45C27 39 31 35 35 33" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".9"/>
</symbol>

<symbol id="it-snack-5" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="48" fill="url(#gGlow)"/>
  <ellipse cx="50" cy="91" rx="34" ry="4" fill="#000" opacity=".15"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M14 48V72C14 84 86 84 86 72V48Z" fill="url(#gRed)"/>
    <path d="M14 63C14 73 86 73 86 63" fill="none" stroke="#ffd23f" stroke-width="4"/>
    <ellipse cx="50" cy="48" rx="36" ry="12" fill="#ffd23f"/>
    <path d="M24 39V45A26 9 0 0 0 76 45V39Z" fill="#d98b35"/>
    <ellipse cx="50" cy="39" rx="26" ry="9" fill="url(#gBrown)"/>
    <circle cx="50" cy="39" r="7" fill="#e11d48" stroke-width="2"/>
    <circle cx="28" cy="75" r="3" fill="#ffd23f" stroke-width="2"/><circle cx="72" cy="75" r="3" fill="#ffd23f" stroke-width="2"/>
  </g>
  <text x="50" y="42.6" text-anchor="middle" font-size="9" font-weight="900" fill="#fff" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">囍</text>
  <path d="M20 56C21 64 24 70 28 74" stroke="#fff" stroke-width="3.2" stroke-linecap="round" fill="none" opacity=".75"/>
  <use href="#fx-spark" x="76" y="10" width="18" height="18"/><use href="#fx-spark" x="6" y="18" width="12" height="12"/>
</symbol>

<!-- ======== 禮品線 ======== -->
<symbol id="it-gift-1" viewBox="0 0 100 100">
  <ellipse cx="50" cy="91" rx="34" ry="4" fill="#000" opacity=".12"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <rect x="14" y="38" width="72" height="47" rx="6" fill="#ffc9a5"/>
    <g transform="rotate(-8 50 40)">
      <rect x="24" y="14" width="52" height="46" rx="5" fill="#fff"/>
      <path d="M50 46C36 36 38 24 46 26C49 27 50 30 50 30C50 30 51 27 54 26C62 24 64 36 50 46Z" fill="#fb7185" stroke-width="2.5"/>
      <path d="M32 22H44" stroke="#f3c9a8" stroke-width="2.5"/>
    </g>
    <path d="M14 44L50 66L86 44V79C86 83 84 85 80 85H20C16 85 14 83 14 79Z" fill="url(#gPeach)"/>
    <path d="M15 84L42 62M85 84L58 62" stroke-width="2.4" fill="none"/>
    <circle cx="50" cy="66" r="7" fill="#f97316"/>
  </g>
  <path d="M47 64.5L50 62L53 64.5L50 69Z" fill="#fff"/>
  <path d="M20 52V76" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
</symbol>

<symbol id="it-gift-2" viewBox="0 0 100 100">
  <ellipse cx="50" cy="92" rx="34" ry="4" fill="#000" opacity=".13"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M40 36C40 14 60 14 60 36" fill="none" stroke-width="9"/>
    <path d="M40 36C40 14 60 14 60 36" fill="none" stroke="#d29a5a" stroke-width="3.5"/>
    <path d="M22 32H78L82 88H18Z" fill="url(#gKraft)"/>
    <path d="M70 32H78L82 88H74Z" fill="#b07238"/>
    <path d="M22 32H78L78.6 41H21.4Z" fill="#f8dcb0"/>
    <rect x="31" y="51" width="36" height="23" rx="5" fill="#f97316"/>
    <circle cx="40" cy="37" r="2" fill="#4a2c1a"/><circle cx="60" cy="37" r="2" fill="#4a2c1a"/>
  </g>
  <text x="49" y="67.5" text-anchor="middle" font-size="12.5" font-weight="900" fill="#fff" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">Pay</text>
  <path d="M28 46L26 80" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".55"/>
</symbol>

<symbol id="it-gift-3" viewBox="0 0 100 100">
  <ellipse cx="50" cy="93" rx="30" ry="4" fill="#000" opacity=".12"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M54 52L70 88L62 84L58 92L46 56Z" fill="#3a86d6"/>
    <path d="M46 52L30 88L38 84L42 92L54 56Z" fill="#4a98e8"/>
    <path d="M50 50C34 18 7 26 13 48C17 64 40 62 50 50Z" fill="url(#gBlue)"/>
    <path d="M50 50C66 18 93 26 87 48C83 64 60 62 50 50Z" fill="url(#gBlue)"/>
    <path d="M44 48C34 39 25 39 22 46M56 48C66 39 75 39 78 46" fill="none" stroke="#2c6fb8" stroke-width="2.5"/>
    <rect x="40" y="40" width="20" height="20" rx="8" fill="#6bb4f5"/>
  </g>
  <g fill="#fff" opacity=".85"><circle cx="24" cy="34" r="2.5"/><circle cx="33" cy="44" r="2"/><circle cx="72" cy="32" r="2.5"/><circle cx="80" cy="44" r="2"/></g>
  <path d="M18 40C20 34 25 30 30 29" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".9"/>
  <path d="M45 45L49 44" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
</symbol>

<symbol id="it-gift-4" viewBox="0 0 100 100">
  <ellipse cx="50" cy="91" rx="34" ry="4" fill="#000" opacity=".13"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M50 34C38 13 21 17 27 30C31 38 44 38 50 34Z" fill="url(#gGold)"/>
    <path d="M50 34C62 13 79 17 73 30C69 38 56 38 50 34Z" fill="url(#gGold)"/>
    <rect x="20" y="46" width="60" height="40" rx="5" fill="url(#gBlue)"/>
    <rect x="44" y="46" width="12" height="40" fill="#ffd23f"/>
    <rect x="15" y="34" width="70" height="15" rx="5" fill="#93d3ff"/>
    <rect x="44" y="34" width="12" height="15" fill="#ffe57a"/>
    <circle cx="50" cy="34" r="5" fill="#ffd23f"/>
  </g>
  <g fill="#fff" opacity=".85"><circle cx="28" cy="58" r="2.5"/><circle cx="34" cy="74" r="2.5"/><circle cx="68" cy="60" r="2.5"/><circle cx="72" cy="77" r="2.5"/></g>
  <path d="M21 40H38" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/>
</symbol>

<symbol id="it-gift-5" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="48" fill="url(#gGlow)"/>
  <ellipse cx="50" cy="92" rx="36" ry="4" fill="#000" opacity=".15"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <rect x="18" y="50" width="64" height="38" rx="6" fill="url(#gOrange)"/>
    <rect x="44" y="50" width="12" height="38" fill="#ffd23f"/>
    <rect x="13" y="40" width="74" height="14" rx="5" fill="#ffab5c"/>
    <rect x="44" y="40" width="12" height="14" fill="#ffe57a"/>
    <path d="M30 40L27 17L40 28L50 11L60 28L73 17L70 40Z" fill="url(#gGold)"/>
    <circle cx="27" cy="17" r="3" fill="#fff3a0"/><circle cx="50" cy="11" r="3" fill="#fff3a0"/><circle cx="73" cy="17" r="3" fill="#fff3a0"/>
    <circle cx="50" cy="30" r="4" fill="#ef4444" stroke-width="2"/>
    <circle cx="38" cy="34" r="2.5" fill="#38bdf8" stroke-width="2"/><circle cx="62" cy="34" r="2.5" fill="#38bdf8" stroke-width="2"/>
    <rect x="29" y="61" width="42" height="17" rx="4" fill="#fff3d6"/>
  </g>
  <text x="50" y="74" text-anchor="middle" font-size="11.5" font-weight="900" fill="#c2410c" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">招牌</text>
  <path d="M22 56V80" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>
  <use href="#fx-spark" x="80" y="6" width="16" height="16"/><use href="#fx-spark" x="4" y="22" width="12" height="12"/><use href="#fx-spark" x="86" y="50" width="10" height="10"/>
</symbol>

<!-- ======== 水果線（Lv.6） ======== -->
<symbol id="it-fruit-1" viewBox="0 0 100 100">
  <ellipse cx="50" cy="91" rx="26" ry="4" fill="#000" opacity=".12"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M50 34C44 22 34 18 28 20C36 24 42 30 46 36M50 34C56 22 66 18 72 20C64 24 58 30 54 36M50 36C49 22 50 12 50 8C52 14 53 24 52 36" fill="#4ade80"/>
    <ellipse cx="50" cy="62" rx="24" ry="28" fill="url(#gGold)"/>
    <path d="M34 48L66 78M30 62L56 86M44 38L72 64M66 46L34 78M70 60L46 86M56 38L28 66" stroke="#c2410c" stroke-width="2" fill="none" opacity=".55"/>
  </g>
  <path d="M33 54C33 46 37 42 41 40" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".8"/>
</symbol>

<symbol id="it-fruit-2" viewBox="0 0 100 100">
  <ellipse cx="50" cy="91" rx="32" ry="4" fill="#000" opacity=".12"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M56 22C62 12 74 12 80 16C74 22 64 24 56 22Z" fill="#4ade80"/>
    <path d="M54 22C56 18 56 16 55 13" fill="none" stroke-width="3.5"/>
    <path d="M52 24C76 22 90 46 84 66C78 86 50 90 32 82C14 74 12 52 22 38C30 28 40 24 52 24Z" fill="url(#gOrange)"/>
    <path d="M60 30C78 34 86 52 80 66" stroke="#ef4444" stroke-width="2.5" fill="none" opacity=".45"/>
  </g>
  <path d="M26 46C28 38 34 33 40 31" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".85"/>
  <circle cx="28" cy="56" r="2.5" fill="#fff" opacity=".7"/>
</symbol>

<symbol id="it-fruit-3" viewBox="0 0 100 100">
  <ellipse cx="50" cy="90" rx="36" ry="4" fill="#000" opacity=".13"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <rect x="14" y="40" width="72" height="46" rx="8" fill="#f8dcb0"/>
    <rect x="20" y="30" width="60" height="40" rx="7" fill="url(#gKraft)"/>
    <rect x="26" y="36" width="48" height="28" rx="5" fill="#e9a55a"/>
    <path d="M32 44H68M32 50H68M32 56H68" stroke="#c97a2c" stroke-width="2" fill="none"/>
  </g>
  <rect x="40" y="72" width="20" height="10" rx="3" fill="#ffd23f" stroke="#4a2c1a" stroke-width="2.5"/>
  <text x="50" y="80.5" text-anchor="middle" font-size="7.5" font-weight="900" fill="#c2410c" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">酥</text>
  <path d="M26 40C28 36 32 34 36 34" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".75"/>
</symbol>

<symbol id="it-fruit-4" viewBox="0 0 100 100">
  <ellipse cx="50" cy="92" rx="30" ry="4" fill="#000" opacity=".13"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M18 54H82L72 84C70 88 66 90 62 90H38C34 90 30 88 28 84Z" fill="#93d3ff"/>
    <path d="M22 54C20 34 34 24 50 24C66 24 80 34 78 54Z" fill="#fff"/>
    <rect x="28" y="34" width="13" height="13" rx="3" fill="url(#gOrange)" stroke-width="2.4"/>
    <rect x="44" y="28" width="13" height="13" rx="3" fill="url(#gOrange)" stroke-width="2.4"/>
    <rect x="58" y="36" width="13" height="13" rx="3" fill="url(#gOrange)" stroke-width="2.4"/>
    <rect x="40" y="43" width="13" height="11" rx="3" fill="#ffd23f" stroke-width="2.4"/>
    <path d="M58 18L66 8" stroke-width="3.5"/>
  </g>
  <path d="M30 60L34 82" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".7"/>
  <use href="#fx-spark" x="78" y="16" width="14" height="14"/>
</symbol>

<symbol id="it-fruit-5" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="48" fill="url(#gGlow)"/>
  <ellipse cx="50" cy="92" rx="36" ry="4" fill="#000" opacity=".15"/>
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M22 50C22 22 78 22 78 50" fill="none" stroke-width="7"/>
    <path d="M22 50C22 22 78 22 78 50" fill="none" stroke="#d29a5a" stroke-width="2.5"/>
    <circle cx="36" cy="46" r="11" fill="url(#gOrange)"/>
    <ellipse cx="54" cy="42" rx="9" ry="12" fill="url(#gGold)"/>
    <circle cx="68" cy="48" r="9" fill="#ef4444"/>
    <path d="M14 52H86L78 86C77 89 74 90 71 90H29C26 90 23 89 22 86Z" fill="url(#gKraft)"/>
    <path d="M18 62H82M21 74H79" stroke="#b07238" stroke-width="2.4" fill="none"/>
    <rect x="34" y="58" width="32" height="16" rx="4" fill="#fff3d6"/>
  </g>
  <text x="50" y="70.5" text-anchor="middle" font-size="10" font-weight="900" fill="#c2410c" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">禮籃</text>
  <use href="#fx-spark" x="80" y="6" width="16" height="16"/><use href="#fx-spark" x="4" y="24" width="12" height="12"/>
</symbol>

<!-- ======== 顧客角色 ======== -->
<symbol id="cu-atao" viewBox="0 0 120 130">
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <circle cx="33" cy="30" r="13" fill="#f2876a"/><circle cx="87" cy="30" r="13" fill="#f2876a"/>
    <path d="M26 60C20 26 100 26 94 60C96 76 92 88 85 88L84 66H36L35 88C28 88 24 76 26 60Z" fill="#f2876a"/>
    <path d="M14 130C14 106 34 96 60 96C86 96 106 106 106 130Z" fill="#fb7185"/>
    <path d="M46 97L60 111L74 97" fill="#fff"/>
    <path d="M52 86V100H68V86Z" fill="#f5c39b"/>
    <circle cx="30" cy="62" r="7" fill="#ffd9b8"/><circle cx="90" cy="62" r="7" fill="#ffd9b8"/>
    <path d="M30 56C30 32 90 32 90 56C90 82 76 94 60 94C44 94 30 82 30 56Z" fill="#ffe1c4"/>
    <path d="M30 58C28 36 44 28 60 30C76 28 92 36 90 58C84 50 77 44 71 42C66 50 54 52 44 50C40 54 35 56 30 58Z" fill="#f2876a"/>
    <path d="M82 38C76 36 76 27 82 27C88 27 88 36 82 38Z" fill="#ffb3a0" stroke-width="2.4"/>
    <path d="M82 27C82 23 86 21 88 23" fill="#5cb847" stroke-width="2.2"/>
    <path d="M54 77Q60 86 66 77Z" fill="#c2410c" stroke-width="2.4"/>
  </g>
  <path d="M60 104L60 111" stroke="#fb7185" stroke-width="2"/>
  <g fill="#2b1a10"><ellipse cx="48" cy="64" rx="4.2" ry="5.5"/><ellipse cx="72" cy="64" rx="4.2" ry="5.5"/></g>
  <g fill="#fff"><circle cx="49.6" cy="61.8" r="1.7"/><circle cx="73.6" cy="61.8" r="1.7"/></g>
  <g fill="#ff8a8a" opacity=".55"><ellipse cx="41" cy="74" rx="6" ry="3.5"/><ellipse cx="79" cy="74" rx="6" ry="3.5"/></g>
  <path d="M40 34C46 30 52 30 56 31" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".55"/>
</symbol>

<symbol id="cu-aming" viewBox="0 0 120 130">
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M28 64C24 42 32 34 40 34H80C88 34 96 42 92 64Z" fill="#3b2a20"/>
    <path d="M14 130C14 106 34 96 60 96C86 96 106 106 106 130Z" fill="#3b82f6"/>
    <path d="M38 101C46 93 74 93 82 101" fill="none" stroke="#1d4ed8" stroke-width="7"/>
    <path d="M52 86V100H68V86Z" fill="#f5c39b"/>
    <circle cx="30" cy="62" r="7" fill="#ffd9b8"/><circle cx="90" cy="62" r="7" fill="#ffd9b8"/>
    <path d="M30 56C30 32 90 32 90 56C90 82 76 94 60 94C44 94 30 82 30 56Z" fill="#ffe1c4"/>
    <path d="M31 56C33 46 87 46 89 56L83 52L77 58L70 51L62 58L55 51L47 58L41 51L36 58Z" fill="#3b2a20"/>
    <path d="M27 49C27 20 93 20 93 49Z" fill="url(#gOrange)"/>
    <path d="M22 47C40 40 80 40 98 47C94 54 26 54 22 47Z" fill="#ea580c"/>
    <circle cx="60" cy="21" r="3" fill="#ffd23f" stroke-width="2"/>
    <circle cx="60" cy="36" r="7" fill="#fff" stroke-width="2.4"/>
    <path d="M42 57L52 56M68 56L78 57" stroke-width="3.2"/>
    <path d="M51 77Q60 86 69 77" fill="none" stroke-width="2.8"/>
    <path d="M53 108V120M67 108V120" stroke="#fff" stroke-width="2.6"/>
  </g>
  <path d="M60 32.5L61.2 35L64 35.3L62 37.2L62.5 40L60 38.6L57.5 40L58 37.2L56 35.3L58.8 35Z" fill="#f97316"/>
  <g fill="#2b1a10"><ellipse cx="48" cy="65" rx="4" ry="5.2"/><ellipse cx="72" cy="65" rx="4" ry="5.2"/></g>
  <g fill="#fff"><circle cx="49.5" cy="63" r="1.6"/><circle cx="73.5" cy="63" r="1.6"/></g>
  <g fill="#ff8a8a" opacity=".45"><ellipse cx="41" cy="75" rx="6" ry="3.2"/><ellipse cx="79" cy="75" rx="6" ry="3.2"/></g>
  <path d="M38 34C44 27 52 25 58 25" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".6"/>
</symbol>

<symbol id="cu-xiaoan" viewBox="0 0 120 130">
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M27 64C23 36 97 36 93 64V82C89 87 84 85 84 79V66H36V79C36 85 31 87 27 82Z" fill="#4a3426"/>
    <path d="M20 130C20 108 38 98 60 98C82 98 100 108 100 130Z" fill="#fffaf2"/>
    <path d="M34 108L40 130M86 108L80 130" stroke-width="10"/>
    <path d="M34 108L40 130M86 108L80 130" stroke="#ef4444" stroke-width="5"/>
    <path d="M49 99L60 108L71 99Z" fill="#60a5fa"/>
    <path d="M53 86V100H67V86Z" fill="#f5c39b"/>
    <circle cx="29" cy="63" r="7" fill="#ffd9b8"/><circle cx="91" cy="63" r="7" fill="#ffd9b8"/>
    <path d="M29 58C29 34 91 34 91 58C91 84 77 96 60 96C43 96 29 84 29 58Z" fill="#ffe1c4"/>
    <path d="M30 61C28 44 92 44 90 61L84 56L78 61L72 55L66 61L60 55L54 61L48 55L42 61L36 55Z" fill="#4a3426"/>
    <path d="M32 47C32 22 88 22 88 47Z" fill="#facc15"/>
    <path d="M18 49C30 41 90 41 102 49C97 56 23 56 18 49Z" fill="#fde047"/>
    <path d="M33 43C50 39 70 39 87 43" stroke="#f97316" stroke-width="4"/>
    <path d="M55 79Q60 88 65 79Z" fill="#c2410c" stroke-width="2.4"/>
  </g>
  <g fill="#2b1a10"><ellipse cx="47" cy="67" rx="5" ry="6.5"/><ellipse cx="73" cy="67" rx="5" ry="6.5"/></g>
  <g fill="#fff"><circle cx="49" cy="64.5" r="2"/><circle cx="75" cy="64.5" r="2"/><circle cx="45.5" cy="69.5" r="1"/><circle cx="71.5" cy="69.5" r="1"/></g>
  <g fill="#ff8a8a" opacity=".6"><ellipse cx="39" cy="77" rx="6" ry="3.5"/><ellipse cx="81" cy="77" rx="6" ry="3.5"/></g>
  <g fill="#d49a6a"><circle cx="37" cy="74" r="1"/><circle cx="41" cy="73" r="1"/><circle cx="79" cy="73" r="1"/><circle cx="83" cy="74" r="1"/></g>
  <path d="M40 32C46 27 54 26 60 26" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".7"/>
</symbol>

<symbol id="cu-chen" viewBox="0 0 120 130">
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <g fill="#6b3f52">
      <circle cx="30" cy="50" r="11"/><circle cx="27" cy="64" r="10"/><circle cx="31" cy="77" r="9"/>
      <circle cx="90" cy="50" r="11"/><circle cx="93" cy="64" r="10"/><circle cx="89" cy="77" r="9"/>
      <circle cx="38" cy="35" r="11"/><circle cx="51" cy="28" r="11"/><circle cx="65" cy="27" r="11"/><circle cx="78" cy="32" r="11"/><circle cx="86" cy="41" r="10"/>
    </g>
    <path d="M14 130C14 106 34 96 60 96C86 96 106 106 106 130Z" fill="#c084fc"/>
    <path d="M38 102C42 110 44 120 44 130M82 102C78 110 76 120 76 130" fill="none" stroke="#a855f7" stroke-width="5"/>
    <path d="M52 86V100H68V86Z" fill="#f5c39b"/>
    <path d="M30 56C30 32 90 32 90 56C90 82 76 94 60 94C44 94 30 82 30 56Z" fill="#ffe1c4"/>
    <g fill="#6b3f52"><circle cx="40" cy="44" r="8"/><circle cx="52" cy="40" r="8"/><circle cx="65" cy="40" r="8"/><circle cx="78" cy="45" r="8"/></g>
    <circle cx="48" cy="64" r="9.5" fill="#fff" fill-opacity=".35" stroke="#7c2d12" stroke-width="2.6"/>
    <circle cx="72" cy="64" r="9.5" fill="#fff" fill-opacity=".35" stroke="#7c2d12" stroke-width="2.6"/>
    <path d="M57.5 64H62.5" stroke="#7c2d12" stroke-width="2.6"/>
    <path d="M44 65Q48 61 52 65M68 65Q72 61 76 65" fill="none" stroke-width="2.6"/>
    <path d="M52 79Q60 88 68 79" fill="none" stroke-width="2.8"/>
  </g>
  <g fill="#fff" stroke="#4a2c1a" stroke-width="1.4"><circle cx="48" cy="99" r="2.6"/><circle cx="54" cy="102.5" r="2.6"/><circle cx="60" cy="103.5" r="2.6"/><circle cx="66" cy="102.5" r="2.6"/><circle cx="72" cy="99" r="2.6"/></g>
  <g fill="#ffd23f" stroke="#4a2c1a" stroke-width="1.5"><circle cx="31" cy="72" r="3"/><circle cx="89" cy="72" r="3"/></g>
  <g fill="#fff" opacity=".85"><circle cx="24" cy="116" r="2.5"/><circle cx="96" cy="118" r="2.5"/><circle cx="88" cy="110" r="2"/><circle cx="30" cy="124" r="2"/></g>
  <g fill="#ff8a8a" opacity=".55"><ellipse cx="40" cy="76" rx="6" ry="3.5"/><ellipse cx="80" cy="76" rx="6" ry="3.5"/></g>
  <g fill="none" stroke="#8a5570" stroke-width="2" stroke-linecap="round"><path d="M48 25q3 3 6 0M62 24q3 3 6 0M36 33q3 3 6 0"/></g>
</symbol>

<!-- ======== 介面圖示 ======== -->
<symbol id="ic-coin" viewBox="0 0 100 100">
  <ellipse cx="50" cy="56" rx="40" ry="40" fill="#c97a06"/>
  <circle cx="50" cy="50" r="40" fill="url(#gGold)" stroke="#8a5205" stroke-width="5"/>
  <circle cx="50" cy="50" r="27" fill="none" stroke="#e59a0c" stroke-width="4"/>
  <path d="M50 30C38 42 38 56 50 68C62 56 62 42 50 30Z" fill="#fff3a0" stroke="#b9770e" stroke-width="4" stroke-linejoin="round"/>
  <path d="M50 36V64" stroke="#b9770e" stroke-width="3"/>
  <path d="M24 38C28 28 36 21 46 19" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".8"/>
</symbol>
<symbol id="ic-star" viewBox="0 0 100 100">
  <path d="M50 8L62 36L92 38L69 58L77 88L50 72L23 88L31 58L8 38L38 36Z" fill="url(#gBlue)" stroke="#1e4f8f" stroke-width="5" stroke-linejoin="round"/>
  <path d="M32 44L40 42L45 28" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none" opacity=".8"/>
</symbol>
<symbol id="ic-shop" viewBox="0 0 100 100">
  <g stroke="#4a2c1a" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <rect x="16" y="42" width="68" height="46" rx="4" fill="#fff3df"/>
    <rect x="42" y="60" width="18" height="28" fill="#b8763a"/>
    <rect x="22" y="56" width="14" height="14" rx="2" fill="#a9e0ff"/><rect x="66" y="56" width="12" height="14" rx="2" fill="#a9e0ff"/>
    <path d="M10 42L18 18H82L90 42C90 50 78 50 78 42C78 50 64 50 64 42C64 50 50 50 50 42C50 50 36 50 36 42C36 50 22 50 22 42C22 50 10 50 10 42Z" fill="#f97316"/>
    <path d="M36 42L40 18M64 42L60 18M50 42V18" stroke-width="3"/>
  </g>
</symbol>
<symbol id="ic-crate" viewBox="0 0 100 100">
  <use href="#it-tea-1" x="10" y="0" width="44" height="44"/>
  <use href="#it-gift-1" x="46" y="2" width="40" height="40"/>
  <use href="#it-snack-1" x="28" y="6" width="38" height="38"/>
  <g stroke="#4a2c1a" stroke-width="3.5" stroke-linejoin="round">
    <rect x="8" y="38" width="84" height="52" rx="7" fill="url(#gWood)"/>
    <path d="M8 56H92M8 73H92" stroke="#7a4a1e" stroke-width="2.5"/>
    <rect x="31" y="50" width="38" height="24" rx="5" fill="#fff3df"/>
  </g>
  <text x="50" y="67.5" text-anchor="middle" font-size="14" font-weight="900" fill="#c2410c" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">原料</text>
  <path d="M14 44H40" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/>
</symbol>
<symbol id="ic-chest" viewBox="0 0 100 100">
  <ellipse cx="50" cy="90" rx="38" ry="5" fill="#000" opacity=".15"/>
  <g stroke="#4a2c1a" stroke-width="3.5" stroke-linejoin="round">
    <rect x="12" y="46" width="76" height="40" rx="6" fill="url(#gWood)"/>
    <path d="M12 50V36C12 18 88 18 88 36V50Z" fill="#c9843f"/>
    <path d="M26 24V86M74 24V86" stroke="#4a2c1a" stroke-width="12"/>
    <path d="M26 24V86M74 24V86" stroke="#ffd23f" stroke-width="6"/>
    <rect x="40" y="40" width="20" height="20" rx="4" fill="#ffd23f"/>
  </g>
  <circle cx="50" cy="48" r="2.8" fill="#4a2c1a"/><path d="M50 49V55" stroke="#4a2c1a" stroke-width="3"/>
  <path d="M18 34C22 27 30 24 38 23" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".6"/>
</symbol>
<symbol id="ic-chest-open" viewBox="0 0 100 100">
  <circle cx="50" cy="44" r="46" fill="url(#gGlow)"/>
  <ellipse cx="50" cy="90" rx="38" ry="5" fill="#000" opacity=".15"/>
  <g stroke="#4a2c1a" stroke-width="3.5" stroke-linejoin="round">
    <path d="M12 46L18 14H82L88 46Z" fill="#8a5426"/>
    <path d="M26 46L29 14M74 46L71 14" stroke="#ffd23f" stroke-width="5"/>
    <circle cx="36" cy="44" r="9" fill="url(#gGold)" stroke-width="2.5"/><circle cx="64" cy="44" r="9" fill="url(#gGold)" stroke-width="2.5"/><circle cx="50" cy="40" r="10" fill="url(#gGold)" stroke-width="2.5"/>
    <rect x="12" y="46" width="76" height="40" rx="6" fill="url(#gWood)"/>
    <path d="M26 46V86M74 46V86" stroke="#4a2c1a" stroke-width="12"/>
    <path d="M26 46V86M74 46V86" stroke="#ffd23f" stroke-width="6"/>
    <rect x="40" y="50" width="20" height="16" rx="4" fill="#ffd23f"/>
  </g>
  <use href="#fx-spark" x="10" y="4" width="16" height="16"/><use href="#fx-spark" x="74" y="0" width="18" height="18"/>
</symbol>
<symbol id="ic-book" viewBox="0 0 100 100">
  <g stroke="#4a2c1a" stroke-width="4" stroke-linejoin="round">
    <path d="M50 24C38 16 22 16 12 20V84C22 80 38 80 50 88C62 80 78 80 88 84V20C78 16 62 16 50 24Z" fill="#fff3df"/>
    <path d="M50 24V88" />
    <path d="M12 20C22 16 38 16 50 24V30C38 22 22 22 12 26Z" fill="#4a98e8"/>
    <path d="M88 20C78 16 62 16 50 24V30C62 22 78 22 88 26Z" fill="#4a98e8"/>
  </g>
  <use href="#it-tea-4" x="18" y="34" width="28" height="28"/><use href="#it-gift-4" x="56" y="36" width="26" height="26"/>
  <g stroke="#e3c7a2" stroke-width="3" stroke-linecap="round"><path d="M20 70H42M58 70H80"/></g>
</symbol>
<symbol id="ic-quest" viewBox="0 0 100 100">
  <g stroke="#4a2c1a" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <rect x="18" y="16" width="64" height="74" rx="8" fill="#fff3df"/>
    <rect x="34" y="8" width="32" height="16" rx="5" fill="#f97316"/>
    <circle cx="32" cy="42" r="6" fill="#3fae2a"/><circle cx="32" cy="60" r="6" fill="#3fae2a"/><circle cx="32" cy="78" r="6" fill="#fff"/>
    <path d="M46 42H70M46 60H70M46 78H64" stroke="#d6b38a"/>
  </g>
  <path d="M29 42L31.5 44.5L35.5 39.5M29 60L31.5 62.5L35.5 57.5" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>
<symbol id="ic-up" viewBox="0 0 100 100">
  <use href="#ic-shop" x="0" y="8" width="84" height="84"/>
  <g class="up-arrow"><path d="M78 6L96 28H86V46H70V28H60Z" fill="#b5f57a" stroke="#4a2c1a" stroke-width="4" stroke-linejoin="round"/></g>
</symbol>
<symbol id="ic-street" viewBox="0 0 100 100">
  <g stroke="#4a2c1a" stroke-width="3.5" stroke-linejoin="round">
    <rect x="6" y="40" width="40" height="46" rx="3" fill="#fff3df"/><rect x="54" y="30" width="40" height="56" rx="3" fill="#fde2b8"/>
    <path d="M4 40L10 24H42L48 40Z" fill="#ef4444"/><path d="M52 30L58 14H90L96 30Z" fill="#3fae2a"/>
    <rect x="18" y="62" width="14" height="24" fill="#b8763a"/><rect x="66" y="58" width="16" height="28" fill="#b8763a"/>
    <rect x="2" y="86" width="96" height="8" rx="3" fill="#a8a29e"/>
  </g>
  <use href="#fx-spark" x="40" y="4" width="16" height="16"/>
</symbol>
<symbol id="ic-blocks" viewBox="0 0 100 100">
  <g stroke="#4a2c1a" stroke-width="3.5" stroke-linejoin="round">
    <rect x="10" y="52" width="26" height="26" rx="5" fill="#4a98e8"/><rect x="36" y="52" width="26" height="26" rx="5" fill="#4a98e8"/>
    <rect x="36" y="26" width="26" height="26" rx="5" fill="#f97316"/><rect x="62" y="52" width="26" height="26" rx="5" fill="#3fae2a"/>
    <rect x="62" y="26" width="26" height="26" rx="5" fill="#ffd23f"/>
  </g>
  <path d="M15 58H28M41 32H54M67 32H80" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
  <use href="#fx-spark" x="10" y="12" width="18" height="18"/>
</symbol>
<symbol id="ic-trophy" viewBox="0 0 100 100">
  <g stroke="#4a2c1a" stroke-width="4" stroke-linejoin="round">
    <path d="M28 14H72V40C72 54 62 62 50 62C38 62 28 54 28 40Z" fill="url(#gGold)"/>
    <path d="M28 22H14C14 38 22 44 30 44M72 22H86C86 38 78 44 70 44" fill="none"/>
    <rect x="42" y="62" width="16" height="12" fill="#e59a0c"/><rect x="28" y="74" width="44" height="14" rx="3" fill="#8a5426"/>
  </g>
  <path d="M38 22V40" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".75"/>
  <use href="#fx-spark" x="76" y="2" width="16" height="16"/>
</symbol>
<symbol id="ic-check" viewBox="0 0 24 24"><path d="M5 12.5L10 17L19 7" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="ic-heart" viewBox="0 0 24 24"><path d="M12 21C4 15 2 11 2 8C2 5 4.5 3 7 3C9 3 11 4.5 12 6C13 4.5 15 3 17 3C19.5 3 22 5 22 8C22 11 20 15 12 21Z" fill="currentColor" stroke="#4a2c1a" stroke-width="1.6"/></symbol>

<!-- ======== 店面場景 ======== -->
<symbol id="deco-lantern" viewBox="0 0 60 110">
  <path d="M30 0V20" stroke="#4a2c1a" stroke-width="3"/>
  <rect x="19" y="17" width="22" height="8" rx="2" fill="#ffd23f" stroke="#4a2c1a" stroke-width="2.5"/>
  <ellipse cx="30" cy="50" rx="25" ry="27" fill="url(#gRed)" stroke="#4a2c1a" stroke-width="3"/>
  <path d="M30 24V76M17 28C9 44 9 58 17 72M43 28C51 44 51 58 43 72" stroke="#a61e14" stroke-width="2" fill="none"/>
  <rect x="19" y="74" width="22" height="8" rx="2" fill="#ffd23f" stroke="#4a2c1a" stroke-width="2.5"/>
  <path d="M30 82V106M25 84V100M35 84V100" stroke="#ffb020" stroke-width="3" stroke-linecap="round"/>
  <circle cx="30" cy="50" r="11" fill="#ffd23f" stroke="#a61e14" stroke-width="2"/>
  <text x="30" y="55" font-size="13" font-weight="900" text-anchor="middle" fill="#c2410c" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">福</text>
  <path d="M14 40C14 34 17 30 21 28" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".6"/>
</symbol>
<symbol id="deco-plant" viewBox="0 0 80 100">
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round">
    <path d="M40 60C20 50 9 30 17 13C34 22 42 40 40 60Z" fill="url(#gLeaf)"/>
    <path d="M40 60C60 50 71 28 63 11C46 22 38 40 40 60Z" fill="url(#gLeaf2)"/>
    <path d="M40 62C35 40 40 18 41 4C48 20 47 44 40 62Z" fill="url(#gLeaf)"/>
    <path d="M18 60H62L56 96H24Z" fill="url(#gOrange)"/>
    <rect x="14" y="55" width="52" height="11" rx="4" fill="#ffb46b"/>
  </g>
</symbol>
<symbol id="deco-register" viewBox="0 0 80 60">
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round">
    <rect x="18" y="4" width="40" height="22" rx="4" fill="#fff3df"/>
    <rect x="24" y="9" width="28" height="11" rx="2" fill="#9be38a"/>
    <path d="M6 30C6 26 8 24 12 24H68C72 24 74 26 74 30V56H6Z" fill="url(#gOrange)"/>
    <g fill="#fff" stroke-width="2"><rect x="14" y="31" width="10" height="7" rx="2"/><rect x="28" y="31" width="10" height="7" rx="2"/><rect x="42" y="31" width="10" height="7" rx="2"/><rect x="56" y="31" width="10" height="7" rx="2"/></g>
    <rect x="20" y="44" width="40" height="8" rx="2" fill="#ffd23f"/>
  </g>
  <text x="38" y="18.5" text-anchor="middle" font-size="9" font-weight="900" fill="#1f6b14" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">$ 0</text>
</symbol>
<symbol id="deco-jar" viewBox="0 0 60 60">
  <g stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round">
    <rect x="16" y="4" width="28" height="8" rx="3" fill="#b8763a"/>
    <path d="M12 16C12 12 16 12 18 12H42C44 12 48 12 48 16V52C48 56 44 58 40 58H20C16 58 12 56 12 52Z" fill="#e6f7ff" fill-opacity=".75"/>
  </g>
  <use href="#it-tea-1" x="14" y="28" width="32" height="32"/>
  <rect x="18" y="20" width="24" height="12" rx="3" fill="#fff3df" stroke="#4a2c1a" stroke-width="2"/>
  <text x="30" y="29.5" text-anchor="middle" font-size="8" font-weight="900" fill="#3f7d2a" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif">烏龍</text>
</symbol>
<symbol id="scene-shop" viewBox="0 0 1200 300">
  <rect width="1200" height="300" fill="url(#gWall)"/>
  <rect width="1200" height="300" fill="url(#pWall)"/>
  <!-- 圓窗 -->
  <circle cx="330" cy="140" r="66" fill="url(#gSky)"/>
  <g clip-path="url(#cWin)">
    <circle cx="372" cy="104" r="13" fill="#ffd23f"/>
    <ellipse cx="300" cy="106" rx="18" ry="8" fill="#fff"/><ellipse cx="314" cy="100" rx="13" ry="9" fill="#fff"/>
    <path d="M250 170C290 130 320 140 340 152C362 134 392 140 410 160V220H250Z" fill="#9ad874" stroke="#4a2c1a" stroke-width="2.5"/>
    <path d="M250 186C300 166 360 174 410 180V220H250Z" fill="#5fb548" stroke="#4a2c1a" stroke-width="2.5"/>
    <g fill="#3f9b35"><ellipse cx="282" cy="190" rx="12" ry="5"/><ellipse cx="318" cy="186" rx="12" ry="5"/><ellipse cx="354" cy="188" rx="12" ry="5"/><ellipse cx="300" cy="200" rx="12" ry="5"/><ellipse cx="338" cy="200" rx="12" ry="5"/></g>
  </g>
  <circle cx="330" cy="140" r="72" fill="none" stroke="#a86a32" stroke-width="12"/>
  <circle cx="330" cy="140" r="78" fill="none" stroke="#4a2c1a" stroke-width="3"/>
  <circle cx="330" cy="140" r="66" fill="none" stroke="#4a2c1a" stroke-width="3"/>
  <!-- 掛牌 -->
  <path d="M560 54L572 74M640 54L628 74" stroke="#4a2c1a" stroke-width="3"/>
  <rect x="532" y="70" width="136" height="40" rx="10" fill="url(#gWood)" stroke="#4a2c1a" stroke-width="3"/>
  <rect x="540" y="76" width="120" height="28" rx="6" fill="none" stroke="#f6cf98" stroke-width="2"/>
  <text x="600" y="98" text-anchor="middle" font-size="20" font-weight="900" fill="#fff7ea" font-family="Noto Sans TC,Microsoft JhengHei,sans-serif" letter-spacing="3">合成小舖</text>
  <!-- 燈籠 -->
  <use href="#deco-lantern" x="176" y="44" width="56" height="103"/>
  <use href="#deco-lantern" x="808" y="44" width="56" height="103"/>
  <!-- 貨架 -->
  <g stroke="#4a2c1a" stroke-width="3">
    <rect x="884" y="74" width="256" height="146" rx="8" fill="#f8d9ab"/>
    <rect x="874" y="62" width="276" height="14" rx="4" fill="#a86a32"/>
    <rect x="874" y="122" width="276" height="12" rx="4" fill="#b8763a"/>
    <rect x="874" y="188" width="276" height="12" rx="4" fill="#b8763a"/>
  </g>
  <use href="#it-tea-2" x="892" y="76" width="50" height="50"/><use href="#it-tea-3" x="952" y="76" width="50" height="50"/>
  <use href="#it-snack-5" x="1014" y="74" width="52" height="52"/><use href="#it-gift-4" x="1078" y="76" width="50" height="50"/>
  <use href="#it-tea-4" x="894" y="140" width="50" height="50"/><use href="#it-snack-2" x="954" y="142" width="50" height="50"/>
  <use href="#it-gift-2" x="1016" y="140" width="50" height="50"/><use href="#it-snack-4" x="1078" y="140" width="50" height="50"/>
  <!-- 木牆板 -->
  <rect y="224" width="1200" height="76" fill="url(#pPlank)"/>
  <rect y="214" width="1200" height="12" fill="#c98a4b" stroke="#4a2c1a" stroke-width="3"/>
  <use href="#deco-plant" x="70" y="140" width="80" height="100"/>
  <use href="#deco-plant" x="804" y="150" width="66" height="84"/>
  <!-- 遮雨棚 -->
  <rect width="1200" height="40" fill="url(#pAwning)"/>
  <rect y="40" width="1200" height="22" fill="url(#pScallop)"/>
  <path d="M0 40H1200" stroke="#4a2c1a" stroke-width="3"/>
  <path d="M0 6H1200" stroke="#fff" stroke-width="3" opacity=".35"/>
</symbol>
</svg>`
