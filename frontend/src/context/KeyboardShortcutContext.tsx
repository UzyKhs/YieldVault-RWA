import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKeyboardShortcuts, formatShortcut } from '../hooks/useKeyboardShortcuts';
import type { ShortcutDefinition } from '../hooks/useKeyboardShortcuts';
import { useTranslation } from '../i18n';

interface KeyboardShortcutContextValue {
  shortcuts: ShortcutDefinition[];
  isHelpModalOpen: boolean;
  openHelpModal: () => void;
  closeHelpModal: () => void;
  isPaletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  formatShortcut: typeof formatShortcut;
}

const KeyboardShortcutContext = createContext<KeyboardShortcutContextValue | null>(null);

interface KeyboardShortcutProviderProps {
  children: React.ReactNode;
  walletAddress: string | null;
}

export const KeyboardShortcutProvider: React.FC<KeyboardShortcutProviderProps> = ({ 
  children,
  walletAddress 
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  const openHelpModal = useCallback(() => {
    setIsHelpModalOpen(true);
  }, []);

  const closeHelpModal = useCallback(() => {
    setIsHelpModalOpen(false);
  }, []);

  const openPalette = useCallback(() => {
    setIsPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setIsPaletteOpen(false);
  }, []);

  const shortcuts = useMemo<ShortcutDefinition[]>(() => [
    // ── Navigation ──
    {
      key: 'g',
      action: () => navigate('/'),
      description: t('commands.goToVaults'),
      scope: t('commands.scopes.navigation')
    },
    {
      key: 'p',
      action: () => navigate('/portfolio'),
      description: t('commands.goToPortfolio'),
      scope: t('commands.scopes.navigation')
    },
    {
      key: 'a',
      action: () => navigate('/analytics'),
      description: t('commands.goToAnalytics'),
      scope: t('commands.scopes.navigation')
    },
    {
      key: 'h',
      action: () => navigate('/transactions'),
      description: t('commands.goToHistory'),
      scope: t('commands.scopes.navigation')
    },
    // ── Actions ──
    {
      key: 'd',
      action: () => {
        if (!walletAddress) {
          window.dispatchEvent(new CustomEvent('TRIGGER_WALLET_CONNECT'));
          return;
        }
        navigate('/');
        setTimeout(() => window.dispatchEvent(new CustomEvent('TRIGGER_DEPOSIT')), 100);
      },
      description: t('commands.deposit'),
      scope: t('commands.scopes.actions')
    },
    {
      key: 'w',
      action: () => {
        if (!walletAddress) {
          window.dispatchEvent(new CustomEvent('TRIGGER_WALLET_CONNECT'));
          return;
        }
        navigate('/');
        setTimeout(() => window.dispatchEvent(new CustomEvent('TRIGGER_WITHDRAW')), 100);
      },
      description: t('commands.withdraw'),
      scope: t('commands.scopes.actions')
    },
    {
      key: 'c',
      action: () => window.dispatchEvent(new CustomEvent('TRIGGER_WALLET_CONNECT')),
      description: t('commands.connectWallet'),
      scope: t('commands.scopes.actions')
    },
    {
      key: 's',
      action: () => navigate('/settings'),
      description: t('commands.settings'),
      scope: t('commands.scopes.actions')
    },
    // ── General ──
    {
      key: '?',
      shiftKey: true,
      action: openHelpModal,
      description: t('commands.showShortcuts'),
      scope: t('commands.scopes.general')
    },
    {
      key: 'k',
      metaKey: true,
      action: openPalette,
      description: t('commands.openPalette'),
      scope: t('commands.scopes.general')
    },
    {
      key: 'Escape',
      action: () => {
        closePalette();
        closeHelpModal();
      },
      description: t('commands.closeModal'),
      scope: t('commands.scopes.general')
    }
  ], [navigate, openHelpModal, closeHelpModal, openPalette, closePalette, walletAddress, t]);

  useKeyboardShortcuts(shortcuts, true);

  const contextValue = useMemo<KeyboardShortcutContextValue>(() => ({
    shortcuts,
    isHelpModalOpen,
    openHelpModal,
    closeHelpModal,
    isPaletteOpen,
    openPalette,
    closePalette,
    formatShortcut
  }), [shortcuts, isHelpModalOpen, openHelpModal, closeHelpModal, isPaletteOpen, openPalette, closePalette]);

  return (
    <KeyboardShortcutContext.Provider value={contextValue}>
      {children}
    </KeyboardShortcutContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useKeyboardShortcutContext(): KeyboardShortcutContextValue {
  const context = useContext(KeyboardShortcutContext);
  if (!context) {
    throw new Error('useKeyboardShortcutContext must be used within KeyboardShortcutProvider');
  }
  return context;
}
