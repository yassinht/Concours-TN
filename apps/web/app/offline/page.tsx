export default function Offline() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-bold">أنت غير متصل بالإنترنت · Hors ligne</h1>
      <p className="text-muted">يمكنك مواصلة المراجعة بالمحتوى الذي حمّلته مسبقًا. · Vous pouvez réviser le contenu téléchargé.</p>
      <a className="font-semibold text-primary underline" href="/app/offline">المحتوى المحمّل · Contenu hors ligne</a>
    </main>
  );
}
