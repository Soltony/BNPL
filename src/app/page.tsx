import { CurrentTime } from '@/components/current-time';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-6xl font-bold font-headline tracking-tight">
          BasePage
        </h1>
        <CurrentTime />
      </div>
    </main>
  );
}
