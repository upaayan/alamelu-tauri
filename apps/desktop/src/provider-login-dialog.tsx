import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { ProviderLoginResponse, ProviderLoginState } from "./ipc";

interface ProviderLoginDialogProps {
  readonly state: ProviderLoginState;
  readonly providerName: string;
  readonly onRespond: (response: ProviderLoginResponse) => void;
  readonly onCancel: (requestId: string) => void;
  readonly onDismiss: () => void;
  readonly onOpenExternal: (url: string) => void;
}

export function isProviderLoginPending(state: ProviderLoginState): boolean {
  return !["idle", "complete", "cancelled", "error"].includes(state.status);
}

export function isProviderLoginDialogVisible(state: ProviderLoginState): boolean {
  return !["idle", "complete", "cancelled"].includes(state.status);
}

export function ProviderLoginDialog({
  state,
  providerName,
  onRespond,
  onCancel,
  onDismiss,
  onOpenExternal,
}: ProviderLoginDialogProps) {
  const [draft, setDraft] = useState("");
  const requestId = "requestId" in state ? state.requestId : "";
  const inputKey = "requestId" in state ? `${state.requestId}:${state.status}` : state.status;

  useEffect(() => {
    setDraft("");
  }, [inputKey]);

  const title = useMemo(() => {
    if (state.status === "error") {
      return `${providerName} sign-in failed`;
    }
    return `Sign in to ${providerName}`;
  }, [providerName, state.status]);

  if (!isProviderLoginDialogVisible(state) || !requestId) {
    return null;
  }

  const cancel = () => {
    if (state.status === "error") {
      onDismiss();
      return;
    }
    onCancel(requestId);
  };

  const submitPrompt = (type: "manualInput" | "prompt") => {
    onRespond({ requestId, type, value: draft });
  };

  return (
    <div className="extension-dialog-backdrop">
      <div
        aria-modal="true"
        className="extension-dialog provider-login-dialog"
        data-testid="provider-login-dialog"
        role="dialog"
      >
        <div className="extension-dialog__title">{title}</div>
        <ProviderLoginDialogBody
          state={state}
          draft={draft}
          onChangeDraft={setDraft}
          onOpenExternal={onOpenExternal}
          onRespond={onRespond}
          onSubmitPrompt={submitPrompt}
        />
        <div className="extension-dialog__actions">
          {state.status === "error" ? (
            <button className="button button--primary" type="button" onClick={onDismiss}>
              Dismiss
            </button>
          ) : (
            <button className="button button--secondary" type="button" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderLoginDialogBody({
  state,
  draft,
  onChangeDraft,
  onOpenExternal,
  onRespond,
  onSubmitPrompt,
}: {
  readonly state: ProviderLoginState;
  readonly draft: string;
  readonly onChangeDraft: (value: string) => void;
  readonly onOpenExternal: (url: string) => void;
  readonly onRespond: (response: ProviderLoginResponse) => void;
  readonly onSubmitPrompt: (type: "manualInput" | "prompt") => void;
}) {
  switch (state.status) {
    case "idle":
    case "complete":
    case "cancelled":
      return null;
    case "starting":
      return <p className="extension-dialog__body">Preparing provider sign-in.</p>;
    case "select":
      return (
        <>
          <p className="extension-dialog__body">{state.message}</p>
          <div className="extension-dialog__options">
            {state.options.map((option) => (
              <button
                key={option.id}
                className="extension-dialog__option"
                type="button"
                onClick={() => onRespond({ requestId: state.requestId, type: "select", optionId: option.id })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      );
    case "auth":
      return (
        <>
          {state.instructions ? <p className="extension-dialog__body">{state.instructions}</p> : null}
          <LoginUrlBlock url={state.url} onOpenExternal={onOpenExternal} />
          <p className="extension-dialog__body">Waiting for browser authorization.</p>
        </>
      );
    case "manualInput":
      return (
        <>
          {state.instructions ? <p className="extension-dialog__body">{state.instructions}</p> : null}
          {state.url ? <LoginUrlBlock url={state.url} onOpenExternal={onOpenExternal} /> : null}
          <p className="extension-dialog__body">{state.message}</p>
          <ProviderLoginTextInput
            actionLabel="Continue"
            ariaLabel="Redirect URL or code"
            draft={draft}
            multiline
            placeholder="Paste redirect URL or code"
            required
            onChangeDraft={onChangeDraft}
            onSubmit={() => onSubmitPrompt("manualInput")}
          />
        </>
      );
    case "deviceCode":
      return (
        <>
          <p className="extension-dialog__body">Enter this code in the browser to continue signing in.</p>
          <div className="provider-login-code" data-testid="provider-login-device-code">{state.userCode}</div>
          <LoginUrlBlock url={state.verificationUri} onOpenExternal={onOpenExternal} />
          {state.expiresInSeconds ? (
            <p className="extension-dialog__body">This code expires in {Math.ceil(state.expiresInSeconds / 60)} minutes.</p>
          ) : null}
        </>
      );
    case "prompt":
      return (
        <>
          <p className="extension-dialog__body">{state.message}</p>
          <ProviderLoginTextInput
            actionLabel="Continue"
            ariaLabel="Provider login response"
            draft={draft}
            placeholder={state.placeholder ?? ""}
            required={!state.allowEmpty}
            onChangeDraft={onChangeDraft}
            onSubmit={() => onSubmitPrompt("prompt")}
          />
        </>
      );
    case "progress":
      return <p className="extension-dialog__body">{state.message}</p>;
    case "error":
      return <p className="extension-dialog__body settings-warning">{state.message}</p>;
  }
}

function LoginUrlBlock({
  url,
  onOpenExternal,
}: {
  readonly url: string;
  readonly onOpenExternal: (url: string) => void;
}) {
  return (
    <div className="provider-login-url">
      <span>{url}</span>
      <button className="button button--secondary" type="button" onClick={() => onOpenExternal(url)}>
        Open Browser
      </button>
    </div>
  );
}

function ProviderLoginTextInput({
  actionLabel,
  ariaLabel,
  draft,
  multiline = false,
  placeholder,
  required,
  onChangeDraft,
  onSubmit,
}: {
  readonly actionLabel: string;
  readonly ariaLabel: string;
  readonly draft: string;
  readonly multiline?: boolean;
  readonly placeholder: string;
  readonly required: boolean;
  readonly onChangeDraft: (value: string) => void;
  readonly onSubmit: () => void;
}) {
  const disabled = required && draft.trim().length === 0;
  const commonProps = {
    "aria-label": ariaLabel,
    autoFocus: true,
    className: multiline ? "extension-dialog__editor provider-login-input" : "settings-search provider-login-input",
    placeholder,
    value: draft,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChangeDraft(event.target.value),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey) && !disabled) {
        event.preventDefault();
        onSubmit();
      }
    },
  };

  return (
    <div className="provider-login-input-group">
      {multiline ? <textarea {...commonProps} /> : <input {...commonProps} />}
      <button className="button button--primary" disabled={disabled} type="button" onClick={onSubmit}>
        {actionLabel}
      </button>
    </div>
  );
}
