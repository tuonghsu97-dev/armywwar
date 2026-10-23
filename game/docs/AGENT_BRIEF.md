# Brief chung cho sub-agent — WARGRID: Chỉ Huy AI

Game HTML5 + Three.js (không build step), thư mục `D:\HoangKiet\armywwar\game`. GDD gốc: `D:\HoangKiet\armywwar\GDD – Game MOBA chiến thuật 2.5D .pdf` (14 trang, tiếng Việt). Checklist tính năng có mã `F-xx`: `docs/GDD_CHECKLIST.md` — đây là thước đo "xong".

## Kiến trúc (đọc trước khi code)
- `src/core/game.js` — lớp `Game` (mô phỏng thuần, không Three.js), tick cố định 20 Hz, `game.issue(side, cmd)` → hàng đợi lệnh → `game.commandLog` (để replay / đấu data). Đọc phần CONTRACT ở đầu file: system `{name, init?, update(game, dt)}`, thứ tự order, `game.onCommand(type, fn)`, sự kiện `game.events`.
- `src/sim/index.js` — `createGame(opts)` đăng ký mọi system. Mỗi module có `install(game)`.
- `src/sim/unit.js` (Unit), `movement.js` (`setDestination`, `stop`), `path.js` (A*), `combat.js` (`fire`, `computeDamage`, `acquireTarget`, `effRange`, `canHit`), `vision.js` (fog + quy tắc nhìn theo tầng), `commands.js` (deploy/ready/order), `ai.js` + `enemyAI.js` (BASELINE).
- `src/data/units.js` (danh mục đơn vị, giá, CP, tier, khắc chế), `commanders.js`, `maps.js`.
- `src/render/*` — Three.js: `renderer.js` (camera iso), `terrain.js`, `world.js` (đồng bộ entity ↔ mesh), `fx.js`, `models.js` (GLB từ `assets/models/manifest.json`, fallback procedural).
- `src/match.js` — điều phối 1 trận ở trình duyệt (selection, pendingOrder, pendingDeploy, pendingAbility, hotkeys, `match.issue(cmd)`), `src/main.js` — app (menu ↔ trận). `window.__app`, `window.__match` để debug.
- `src/ui/*` — `hud.js`, `input.js`, `screens.js`, `shop.js`, `roster.js`, `abilities.js`, `tutorial.js`, `style.css`.
- Ảnh do Codex vẽ: `assets/img/{units,commanders,maps,bosses,commands}/<id>.png`, `logo.png`, `menu_bg.jpg` (agent khác đang tạo, có thể chưa đủ — luôn có fallback `onerror`).

## Luật làm việc song song (quan trọng)
1. Mỗi agent **sở hữu** một số file (ghi `// OWNER:` ở đầu file). Chỉ viết lại toàn bộ file mình sở hữu.
2. File dùng chung (`core/game.js`, `sim/unit.js`, `sim/combat.js`, `sim/movement.js`, `sim/vision.js`, `sim/commands.js`, `render/world.js`, `match.js`, `data/*.js`, `ui/style.css`, `index.html`): chỉ sửa **nhỏ, cộng thêm** bằng Edit (không Write cả file), đọc lại file ngay trước khi sửa vì agent khác cũng đang sửa. Ưu tiên thêm hook/event thay vì sửa logic người khác. Ghi rõ mọi sửa ở file chung trong báo cáo.
3. Không xóa / đổi tên API đang có. Không đổi chữ ký `createGame`, `Match`, `Game.issue`.
4. Văn bản hiển thị cho người chơi: **tiếng Việt có dấu**. Code/comment: tiếng Anh ngắn gọn, theo phong cách code xung quanh.
5. Không dùng thư viện ngoài mới (chỉ Three.js đã vendor). Không cần build. ES modules.
6. **Không dùng công cụ Browser** (pane trình duyệt dùng chung, agent điều phối sẽ test tích hợp trên trình duyệt). Kiểm tra bằng Node headless:
   - `node tests/sim-harness.mjs [giây] [map] [cmdTa] [cmdĐịch]` — chạy trận AI vs AI.
   - Viết test của mình ở `tests/<khu-vuc>.test.mjs` dùng `node:test` + `node:assert`; chạy `node --test tests/`. Code trong `src/` phải chạy được ở Node khi không đụng DOM (sim không được import Three.js/DOM).
   - Với file UI (DOM), ít nhất chạy `node --check <file>` và kiểm tra import đúng tên export.
7. Không commit git (điều phối viên sẽ commit).

## Báo cáo khi xong (tiếng Anh, ngắn)
- Danh sách mã `F-xx` đã làm / làm đơn giản hóa (ghi cách đơn giản hóa) / chưa làm.
- File đã tạo/sửa, đặc biệt các sửa ở file dùng chung.
- Lệnh test đã chạy + kết quả (số pass/fail).
- API mới mà agent khác/UI cần biết (tên command, event, field).
