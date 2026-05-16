import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ItemErrorBoundaryProps {
  fallback?: ReactNode;
  onError?: (err: unknown, info: ErrorInfo) => void;
  children: ReactNode;
}

interface State { hasError: boolean }

export class ItemErrorBoundary extends Component<ItemErrorBoundaryProps, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State { return { hasError: true }; }

  override componentDidCatch(err: unknown, info: ErrorInfo): void {
    this.props.onError?.(err, info);
  }

  override render(): ReactNode {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
