# Verification report

Ngày kiểm tra: 31/07/2026

## Đã kiểm tra trong môi trường tạo dự án

- Parse/transpile toàn bộ **14 file TypeScript và TSX** bằng TypeScript compiler API: **0 syntax diagnostics**.
- Kiểm tra kiểu tĩnh bằng cấu hình strict và module stubs cho React/Next/OpenAI: **đạt**.
- Kiểm tra JSX của landing page, dialog bối cảnh, live workspace và upload workspace: **đạt**.
- Kiểm tra cân bằng CSS và toàn bộ import nội bộ: **đạt**.
- Rà soát luồng ghi âm hai lớp:
  - WebRTC Realtime hiển thị transcript nháp có độ trễ thấp;
  - MediaRecorder vẫn lưu bản ghi đầy đủ;
  - audio chunk khoảng 12 giây chạy song song để diarization và làm fallback;
  - lỗi/mất Realtime không dừng master recording hoặc chunk queue;
  - pause/resume tác động đồng bộ lên recorder, Realtime và chunk capture;
  - stop flush chunk cuối, chờ queue, đóng media tracks rồi tạo audio tải xuống.
- Rà soát luồng dữ liệu:
  - meeting context → Realtime prompt và transcription API;
  - diarized segments → speaker attribution API;
  - transcript mới → incremental live summary;
  - upload file → chia WAV chunk → transcript → summary;
  - sửa text/tên người nói → đánh dấu summary cần tạo lại.
- Kiểm tra API key chỉ được đọc ở server; không đóng gói `.env.local`.
- Thêm same-origin check, giới hạn kích thước request và rate limit cho bốn API route.
- Thêm `setup.cmd`, `run.cmd`, `verify.cmd` để không phụ thuộc PowerShell Execution Policy.

## Chưa thể chạy trong môi trường tạo dự án

`npm install` và `next build` chưa thể chạy: registry nội bộ thiếu `@types/node`, còn registry công khai bị timeout/DNS giới hạn trong môi trường tạo file. Đây là giới hạn mạng của môi trường hiện tại; vì dependency chưa được tải xuống nên không thể tuyên bố production build đã chạy thành công tại đây.

## Kiểm tra bắt buộc trên máy Windows

Sau khi giải nén:

```bat
setup.cmd
```

Thêm API key vào `.env.local`, sau đó chạy:

```bat
verify.cmd
run.cmd
```

Smoke test nên thực hiện:

1. Mở landing page, xác nhận workspace chưa tự chạy.
2. Nhấn **Bắt đầu cuộc họp**, điền vai trò, chủ đề, số người và tên thành viên.
3. Ghi ít nhất 45 giây; để hai người tự giới thiệu tên.
4. Kiểm tra badge chuyển sang **Realtime** hoặc tự chuyển **Near real-time dự phòng**.
5. Kiểm tra bản nháp xuất hiện trước, sau đó được thay bằng transcript A/B/C có timestamp.
6. Kiểm tra summary tự cập nhật và không biến đề xuất chưa chốt thành quyết định.
7. Tạm dừng, tiếp tục, dừng và tải audio.
8. Upload MP3/WAV và kiểm tra transcript, summary, TXT/Markdown/JSON.
