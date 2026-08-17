# RoughCut 路 绮楀壀

**鍙ｆ挱瑙嗛涓€閿矖鍓?*鈥斺€旇嚜鍔ㄦ娴嬫瘡涓€澶勫仠椤匡紝鎶婂畠浠粺涓€鏀剁揣鍒颁綘鎸囧畾鐨勯棿闅旓紙0.2 绉?/ 0.3 绉?/ 0.5 绉掞紝鑺傚鐢变綘瀹氾級锛岄€愬垏鐐硅瘯鍚€佹暣鐗囬瑙堛€佸鍑猴紝鏀跺伐銆?
[English docs 鈫抅(README.md)

![RoughCut 涓荤晫闈(docs/design/screenshot-app.png)

## 涓轰粈涔堝仛杩欎釜

鐢ㄦ彁璇嶅櫒褰曞彛鎾紝鍋滈】娉ㄥ畾闀跨煭涓嶄竴锛氭湁鐨勭煭銆佹湁鐨勯暱銆佹湁鐨勬槸"鑴戝瓙褰撴満"鐨勪袱涓夌銆傚壀鏄犵瓑宸ュ叿鐨勬櫤鑳藉壀杈戝璇煶闂撮殧璇嗗埆涓嶅噯锛屼篃娌℃硶绮剧‘鎺у埗鍓畬鐨勯棿闅旀椂闀库€斺€旀渶鍚庤繕鏄緱鐩潃娉㈠舰涓€鍒€涓€鍒€鍓紝浜斿垎閽熺礌鏉愬嚑鍗佷笂鐧句釜鍋滈】锛岀函浣撳姏娲汇€?
RoughCut 鍙仛涓€浠朵簨骞跺仛鍑嗭細**璁╁彛鎾噷姣忎竴澶勫仠椤垮彉鎴愪綘鎯宠鐨勭簿纭椂闀?*锛岀洿鎺ュ熀浜庨煶棰戞尝褰㈠畬鎴愩€傚鍑虹殑鎴愮墖浣滀负鏂扮殑鍘熷绱犳潗杩涘壀鏄犲仛浜屾鍒涗綔锛堝瓧骞曘€丅GM銆佽创绾搞€佽皟鑹诧級銆?
## 鍔熻兘

- 鈿?**涓€閿敹绱?*鈥斺€斿熀浜庨煶棰?RMS 鑳介噺妫€娴嬪仠椤匡紝闀夸簬鐩爣闂撮殧鐨勫仠椤垮叏閮ㄧ簿纭敹缂╁埌鐩爣鍊?- 馃帥锔?**鑺傚鍙傛暟鍖?*鈥斺€旂洰鏍囬棿闅斻€佹渶灏忓仠椤裤€侀潤闊抽槇鍊笺€佹棣?娈靛熬淇濈暀鍏ㄩ儴鍙皟锛涙敼鍙傛暟鍗虫椂閲嶇畻锛屾棤闇€閲嶆柊鍒嗘瀽
- 馃憘 **瀵煎嚭鍓嶈瘯鍚?*鈥斺€旂偣鍑讳换鎰忓垏鐐硅瘯鍚?鍓畬鍚庣殑琛旀帴鏁堟灉"锛堝垏鐐瑰墠鍚庡悇 1.2 绉掞級锛?*鏃犻渶瀵煎嚭**鍗冲彲鎶婃暣鐗囨寜鍓緫璁″垝鏃犵紳蹇€熷惉涓€閬嶏紙Web Audio 閲囨牱绾ф嫾鎺ワ級
- 鉁?**鍒囩偣鍙惁鍐?*鈥斺€旀娴嬭鍒囦簡鏌愬锛熷崟鐙彇娑堝嬀閫夐偅涓€涓垏鐐癸紝鍏朵綑涓嶅彈褰卞搷
- 馃摛 **骞插噣鐨勫鍑?*鈥斺€擧.264 MP4锛圕RF 鍙皟锛? 鍙€夌函闊抽 WAV + 璁板綍姣忎竴鍒€鐨?JSON 鍓緫鎶ュ憡
- 馃枼锔?**GUI + 鍛戒护琛屽叡鐢ㄤ竴濂楀紩鎿?*鈥斺€旀闈㈢璐熻矗璇曞惉瀹℃煡娴侊紝CLI 璐熻矗鑴氭湰鍖栨壒澶勭悊锛涗袱绔叡浜悓涓€浠藉壀杈戣鍒?JSON 濂戠害
- 馃攲 **鏃犱簯绔€佹棤妯″瀷**鈥斺€旂函淇″彿鑳介噺鍒嗘瀽 + FFmpeg锛屽揩涓斿畬鍏ㄧ绾?
## 鐜瑕佹眰

- **Node.js 鈮?20**
- **FFmpeg** 鍦?`PATH` 涓紙鎴栬 `ROUGHCUT_FFMPEG` 鐜鍙橀噺鎸囧悜 ffmpeg 绋嬪簭鎴栧叾鐩綍锛?  - Windows锛歚winget install Gyan.FFmpeg` 鎴?`scoop install ffmpeg`
  - macOS锛歚brew install ffmpeg` 路 Linux锛氬彂琛岀増鍖呯鐞嗗櫒

## 蹇€熷紑濮?
```bash
git clone https://github.com/gavinisagi/RoughCut.git
cd roughcut
npm install
npm run build
```

### 妗岄潰绔紙Windows 浼樺厛锛孍lectron锛?
```bash
npm run dev:desktop
```

瀵煎叆瑙嗛锛堟寜閽垨鎷栨嫿锛夆啋 璋冪洰鏍囬棿闅?鈫?璇曞惉鍒囩偣锛坄绌烘牸` = 绱у噾棰勮锛宍Alt+鈫?鈫抈 = 涓?涓嬩竴鍒囩偣锛夆啋 瀵煎嚭鎴愮墖銆?
> HEVC/H.265 绱犳潗浼氳嚜鍔ㄧ敓鎴?H.264 浠ｇ悊鐢ㄤ簬鐢婚潰棰勮锛涘垎鏋愩€佽瘯鍚笌瀵煎嚭濮嬬粓浣跨敤鍘熷鏂囦欢銆?> 涓浗缃戠粶瀹夎 Electron 鎱㈡椂锛歚set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 鍚庡啀 `npm install`銆?
### 鍛戒护琛?
```bash
# 鍏堢湅鐪嬩細鍓摢浜涘湴鏂?node packages/cli/bin/roughcut.js analyze input.mp4 --target-gap 0.3

# 鐩存帴鍓?node packages/cli/bin/roughcut.js cut input.mp4 -o output.mp4 --audio output.wav

# 鍏?JSON 宸ヤ綔娴?node packages/cli/bin/roughcut.js analyze input.mp4 --json > plan.json
# 鈥︹€︽墜宸ユ妸璇垏鍒囩偣鐨?"enabled" 鏀规垚 false 鈥︹€?node packages/cli/bin/roughcut.js cut input.mp4 -o output.mp4 --plan plan.json
```

`npm link -w @roughcut/cli` 涔嬪悗鍙洿鎺ヤ娇鐢?`roughcut` 鍛戒护銆?
甯哥敤鍙傛暟锛堟嫭鍙峰唴涓洪粯璁ゅ€硷級锛歚--target-gap 0.3`锛堝壀瀹屽悗鐨勫仠椤挎椂闀匡級路 `--min-silence 0.45`锛堢煭浜庢涓嶅姩锛壜?`--threshold -38`锛堥潤闊抽槇鍊?dBFS锛屽彲鍐?`--threshold=-38`锛壜?`--pad-before 0.06` / `--pad-after 0.15`锛堥槻鍒囧瓧澶?瀛楀熬锛壜?`--crf 18` 路 `--dry-run` 路 `--json`

## 宸ヤ綔鍘熺悊

1. FFmpeg 鎶婇煶杞ㄨВ鐮佷负 16 kHz 鍗曞０閬?PCM锛岃绠楃煭鏃?RMS锛?0ms 绐?/ 10ms 姝ヨ繘锛夊拰娉㈠舰宄板€尖€斺€旀娴嬩笌鍙鍖栫敤鍚屼竴浠芥暟鎹紝**鎵€瑙佸嵆鎵€鍓?*銆?2. 浣庝簬闃堝€间笖闀夸簬"鏈€灏忓仠椤?鐨勯潤闊虫鍒ゅ畾涓哄仠椤匡紱闀夸簬"鐩爣闂撮殧"鐨勫仠椤跨敓鎴愪竴鍒€锛屽壀瀹屾伆濂界暀涓嬬洰鏍囬棿闅旈暱搴︾殑**鍘熺墖搴曞櫔**锛堝叾涓嚦灏?娈靛熬淇濈暀"璐翠笂涓€鍙ャ€佽嚦灏?娈甸淇濈暀"璐翠笅涓€鍙モ€斺€斾笉鎻掓暟瀛楅潤闊炽€佷笉鍒囧瓧锛夈€?3. 淇濈暀娈电敤 FFmpeg `trim/atrim + concat` 婊ら暅鍥句竴娆￠噸缂栫爜鎷兼帴锛堟绉掔骇绮剧‘锛夛紱婊ら暅鍥捐蛋鑴氭湰鏂囦欢浼犲叆锛學indows 涓婂嚑鐧句釜鍒囩偣涔熸病闂銆?4. 鍓緫鎶ュ憡 JSON锛堜笌璁″垝鍚屾瀯锛夎褰曟瘡澶勫仠椤裤€佹瘡鍒€鍖洪棿鍜屽墠鍚庢椂闀裤€?
鎶€鏈粏鑺傝 [docs/DESIGN.md](docs/DESIGN.md)锛屼骇鍝佽璇佽 [docs/PRD.md](docs/PRD.md)銆?
## 寮€鍙?
```
packages/core     寮曟搸锛氭帰娴?/ 鍒嗘瀽 / 妫€娴?/ 璁″垝 / 瀵煎嚭锛堥浂杩愯鏃朵緷璧栵級
packages/cli      roughcut 鍛戒护琛岋紙闆朵緷璧栵紝璋冪敤 core锛?apps/desktop      Electron + React 妗岄潰绔紙electron-vite锛?```

```bash
npm test          # core 鍗曞厓娴嬭瘯锛圴itest锛?npm run test:e2e  # CLI 绔埌绔紙鍚堟垚濯掍綋锛岄渶瑕?ffmpeg锛?npm run dev:desktop
npm run typecheck
```

GUI 鍐掔儫娴嬭瘯锛堣嚜鍔ㄥ鍏ョ礌鏉愩€佺瓑寰呭垎鏋愬畬鎴愩€佹埅鍥鹃€€鍑猴級锛?
```bash
node scripts/make-sample.mjs sample.mp4
cd apps/desktop && npm run build && npx electron . --smoke ../../sample.mp4
```

璺嚎鍥捐 [docs/STATUS.md](docs/STATUS.md)銆傛杩庤础鐚€斺€旇 [CONTRIBUTING.md](CONTRIBUTING.md)銆?
## 璁稿彲

[MIT](LICENSE)銆侳Fmpeg 涓虹敤鎴疯嚜琛屽畨瑁呯殑鐙珛杩愯鏃朵緷璧栵紝閬靛惊鍏惰嚜韬鍙崗璁€?