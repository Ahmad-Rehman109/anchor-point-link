import { Wifi, WifiOff, Search } from 'lucide-react';

type ConnectionState = 'idle' | 'searching' | 'connected' | 'disconnected';

interface ConnectionStatusProps {
  state: ConnectionState;
}

const ConnectionStatus = ({ state }: ConnectionStatusProps) => {
  const getStatusConfig = () => {
    switch (state) {
      case 'connected':
        return {
          icon: Wifi,
          text: 'Connected',
          className: 'bg-green-500/20 text-green-400 border-green-500/50',
          iconClassName: 'text-green-400 animate-pulse-glow',
        };
      case 'searching':
        return {
          icon: Search,
          text: 'Searching...',
          className: 'bg-accent/20 text-accent-foreground border-accent/50',
          iconClassName: 'text-accent animate-spin',
        };
      case 'disconnected':
        return {
          icon: WifiOff,
          text: 'Disconnected',
          className: 'bg-destructive/20 text-destructive-foreground border-destructive/50',
          iconClassName: 'text-destructive',
        };
      default:
        return {
          icon: WifiOff,
          text: 'Not Connected',
          className: 'bg-muted/50 text-muted-foreground border-border',
          iconClassName: 'text-muted-foreground',
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-full border-2 ${config.className} transition-all duration-300`}>
      <Icon className={`w-4 h-4 ${config.iconClassName}`} />
      <span className="text-sm font-medium">{config.text}</span>
    </div>
  );
};

export default ConnectionStatus;
