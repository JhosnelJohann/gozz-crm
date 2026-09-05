"use client";
import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="h-full flex flex-col items-center justify-center p-8 text-center">
          <div className="text-3xl mb-3">⚠️</div>
          <div className="font-display font-black text-sm mb-1">Algo salió mal</div>
          <div className="text-xs text-neutral-500 max-w-xs">
            {this.state.error?.message || "Error al renderizar este componente"}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
