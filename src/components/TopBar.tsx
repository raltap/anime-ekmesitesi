import { Download, Menu, X } from 'lucide-react';

export type ActiveTab = 'catalog' | 'queue' | 'completed' | 'import' | 'v2';

interface TopBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  selectedEpisodesCount: number;
  activeDownloadsCount: number;
  completedDownloadsCount: number;
  onPrimaryAction: () => void;
  mobileSidebarOpen: boolean;
  onToggleMobileSidebar: () => void;
}

export function TopBar({
  activeTab,
  onTabChange,
  selectedEpisodesCount,
  activeDownloadsCount,
  completedDownloadsCount,
  onPrimaryAction,
  mobileSidebarOpen,
  onToggleMobileSidebar,
}: TopBarProps) {
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'catalog', label: 'Eksik Bölümler' },
    { id: 'v2', label: 'Top 500 & V2 Seri Keşfi' },
    {
      id: 'queue',
      label: activeDownloadsCount > 0 ? `Kuyruk (${activeDownloadsCount})` : 'İndirme Kuyruğu',
    },
    {
      id: 'completed',
      label: completedDownloadsCount > 0 ? `Tamamlananlar (${completedDownloadsCount})` : 'Tamamlananlar',
    },
    { id: 'import', label: 'Rapor Yükle' },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-sm">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            aria-label={mobileSidebarOpen ? 'Filtre panelini kapat' : 'Filtre panelini aç'}
            className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            {mobileSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <a
            href="#catalog"
            onClick={(e) => {
              e.preventDefault();
              onTabChange('catalog');
            }}
            className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            AnimeArşiv İndirici
          </a>
        </div>

        <nav
          aria-label="Ana menü"
          className="hidden md:flex items-center gap-6 overflow-x-auto"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-400"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onPrimaryAction}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {selectedEpisodesCount > 0
                ? `Seçilenleri İndir (${selectedEpisodesCount})`
                : 'Rapor İçe Aktar'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile secondary nav row only on small viewports */}
      <nav
        aria-label="Mobil menü"
        className="md:hidden flex items-center justify-between gap-2 px-3 border-t border-slate-100 dark:border-slate-800 overflow-x-auto"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`py-2.5 text-[11.5px] font-medium whitespace-nowrap shrink-0 border-b-2 ${
                isActive
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
