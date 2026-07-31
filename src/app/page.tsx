import { MeetFlowRecorder } from "@/components/meetflow-recorder";

export default function HomePage() {
  return <MeetFlowRecorder aiConfigured={Boolean(process.env.OPENAI_API_KEY)} />;
}
