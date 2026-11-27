(() => {
  try {
    const saved = localStorage.getItem('ranking-theme');
    document.documentElement.dataset.theme = saved === 'light' || saved === 'dark'
      ? saved : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
})();
