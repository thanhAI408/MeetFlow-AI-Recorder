"use client";

import {
  ArrowRight,
  Bot,
  CalendarClock,
  FileAudio,
  FileCheck2,
  History,
  LockKeyhole,
  Mic2,
  Moon,
  Play,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  Users,
  WandSparkles,
} from "lucide-react";

interface LandingViewProps {
  aiConfigured: boolean;
  onStart(): void;
  onDemo(): void;
  onUpload(): void;
  darkMode: boolean;
  onToggleTheme(): void;
}

const STEPS = [
  {
    number: "01",
    icon: Users,
    title: "Khai báo bối cảnh và người tham gia",
    body: "Cho AI biết người ghi âm là ai, vai trò, chủ đề, số người và tên từng thành viên.",
  },
  {
    number: "02",
    icon: WandSparkles,
    title: "Transcript và phân tách người nói",
    body: "Audio được chia theo lượt nói; AI đối chiếu tên theo bối cảnh và chỉ gán khi đủ căn cứ.",
  },
  {
    number: "03",
    icon: FileCheck2,
    title: "Biên bản cập nhật liên tục",
    body: "Quyết định, đầu việc, người phụ trách và deadline được cập nhật trong lúc cuộc họp diễn ra.",
  },
];

export function LandingView({
  aiConfigured,
  onStart,
  onDemo,
  onUpload,
  darkMode,
  onToggleTheme,
}: LandingViewProps) {
  return (
    <main className="landing-page">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <header className="site-header page-width">
        <a aria-label="MeetFlow AI — Trang chủ" className="brand" href="#top">
          <span className="brand__mark">
            <Sparkles size={20} />
          </span>
          <span>
            MeetFlow <strong>AI</strong>
          </span>
        </a>
        <nav aria-label="Điều hướng chính" className="site-header__actions">
          <span className={`api-status${aiConfigured ? " api-status--ready" : ""}`}>
            <i /> {aiConfigured ? "AI sẵn sàng" : "Demo sẵn sàng"}
          </span>
          <button
            aria-label={darkMode ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
            className="icon-button"
            data-tooltip={darkMode ? "Giao diện sáng" : "Giao diện tối"}
            onClick={onToggleTheme}
            type="button"
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="button button--header" onClick={onStart} type="button">
            Bắt đầu cuộc họp <ArrowRight size={16} />
          </button>
        </nav>
      </header>

      <section className="hero page-width" id="top">
        <div className="hero__copy">
          <div className="hero-badge">
            <span><Bot size={14} /> AI Meeting Copilot</span>
            <i />
            <span>Vietnamese-first</span>
          </div>
          <h1>
            Biến cuộc họp thành <span>quyết định</span> và hành động.
          </h1>
          <p className="hero__lead">
            MeetFlow AI ghi âm có đồng thuận, tạo transcript theo thời gian thực, phân tách
            người nói và liên tục cập nhật biên bản để nhóm bạn nhớ đúng việc, đúng người,
            đúng hạn.
          </p>
          <div className="hero__actions">
            <button className="button button--primary button--large" onClick={onStart} type="button">
              <Mic2 size={18} /> Bắt đầu cuộc họp
            </button>
            <button className="button button--secondary button--large" onClick={onUpload} type="button">
              <Upload size={17} /> Đưa file ghi âm
            </button>
            <button className="button button--ghost button--large" onClick={onDemo} type="button">
              <Play fill="currentColor" size={16} /> Xem demo
            </button>
          </div>
          <div className="trust-row">
            <span><LockKeyhole size={15} /> Bản ghi đầy đủ ở trình duyệt</span>
            <span><ShieldCheck size={15} /> API key ở server</span>
            <span><History size={15} /> Có thể tải audio và biên bản</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="Xem trước meeting workspace">
          <div className="hero-visual__glow" />
          <div className="preview-window">
            <div className="preview-window__topbar">
              <div className="preview-logo"><Sparkles size={14} /></div>
              <span>Họp phân công dự án</span>
              <span className="preview-live"><i /> LIVE · 12:48</span>
            </div>
            <div className="preview-grid">
              <div className="preview-transcript">
                <div className="preview-panel-title">
                  <span>Live transcript</span><small>VI</small>
                </div>
                <PreviewLine speaker="Thành" time="12:42" text="Mình chốt dùng Next.js cho bản demo." />
                <PreviewLine speaker="Lan" time="12:44" text="Mình nhận phần giao diện và upload audio." />
                <PreviewLine speaker="Huy" time="12:47" text="Deadline là 18 giờ thứ Sáu." active />
                <div className="preview-wave">
                  {Array.from({ length: 20 }, (_, index) => <i key={index} />)}
                </div>
              </div>
              <div className="preview-summary">
                <div className="preview-panel-title"><span>Biên bản AI</span><Sparkles size={13} /></div>
                <small>BỐI CẢNH</small>
                <p>Nhóm sinh viên chuẩn bị demo hackathon, 4 người tham gia.</p>
                <small>QUYẾT ĐỊNH</small>
                <p>Dùng Next.js App Router cho prototype.</p>
                <small>ACTION ITEMS</small>
                <div className="preview-task"><i /> <span><strong>Lan</strong> · Hoàn thiện frontend</span></div>
                <div className="preview-task"><i /> <span><strong>Huy</strong> · Tích hợp transcription</span></div>
                <div className="preview-deadline"><CalendarClock size={13} /> Thứ Sáu · 18:00</div>
              </div>
            </div>
          </div>
          <div className="floating-chip floating-chip--privacy"><ShieldCheck size={15} /> Privacy-first</div>
          <div className="floating-chip floating-chip--ai"><Sparkles size={15} /> Live summary</div>
        </div>
      </section>

      <section className="how-it-works page-width" aria-labelledby="how-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Từ lời nói đến việc làm</span>
            <h2 id="how-heading">Ba bước, không bỏ sót đầu việc</h2>
          </div>
          <p>Không cần bot tự tham gia phòng họp.</p>
        </div>
        <div className="steps-grid">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <article className="step-card" key={step.number}>
                <div className="step-card__top">
                  <span className="step-icon"><Icon size={21} /></span>
                  <small>{step.number}</small>
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="landing-cta page-width">
        <div>
          <span className="eyebrow">Sẵn sàng họp</span>
          <h2>Ghi âm trực tiếp hoặc xử lý file có sẵn</h2>
          <p>Transcript, tên người nói, summary, audio, TXT, Markdown và JSON trong một nơi.</p>
        </div>
        <div className="landing-cta__actions">
          <button className="button button--primary" onClick={onStart} type="button"><Mic2 size={17} /> Bắt đầu</button>
          <button className="button button--secondary" onClick={onUpload} type="button"><FileAudio size={17} /> Chọn file</button>
        </div>
      </section>

      <footer className="site-footer page-width">
        <span>MeetFlow AI · T-Hexa E403</span>
        <span>Chỉ ghi âm khi tất cả người tham gia đã đồng ý</span>
      </footer>
    </main>
  );
}

function PreviewLine({
  speaker,
  time,
  text,
  active = false,
}: {
  speaker: string;
  time: string;
  text: string;
  active?: boolean;
}) {
  return (
    <div className={`preview-line${active ? " preview-line--active" : ""}`}>
      <time>{time}</time>
      <span><strong>{speaker}:</strong> {text}</span>
    </div>
  );
}
