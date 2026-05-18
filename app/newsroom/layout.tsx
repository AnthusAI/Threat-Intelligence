import { NewsDeskClientProvider } from "../../components/news-desk-client-provider";

export default function NewsroomLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <NewsDeskClientProvider>{children}</NewsDeskClientProvider>;
}
