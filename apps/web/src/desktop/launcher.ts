/** True in the Electron shell's sign-in badge window (it loads `/launcher`); never in a browser tab. */
export const isLauncherRoute = (): boolean => {
  try {
    return window.mafkDesktop?.isDesktop === true && window.location.pathname === '/launcher';
  } catch {
    return false;
  }
};

/** True inside the desktop shell (the round sign-in badge replaces the splash and the normal sign-in page there). */
export const isDesktopShell = (): boolean => {
  try {
    return window.mafkDesktop?.isDesktop === true;
  } catch {
    return false;
  }
};
