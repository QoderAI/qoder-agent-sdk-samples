import { useState } from "react";
import type { InteractionResponse } from "../../../shared/commands.js";
import type { InteractionView } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";
import { useAppStore } from "../../store/store-context.js";
import { CommandFailureNotice } from "../errors/command-failure-notice.js";
import { McpForm } from "./mcp-form.js";

type Accepted = { commandId: string };

export function InteractionCard(props: {
  interaction: InteractionView;
  respond: (id: string, response: InteractionResponse) => Promise<Accepted>;
  onSelect?: (interactionId: string) => void;
}): JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [denial, setDenial] = useState(copy.interaction.denialDefault);
  const [interrupt, setInterrupt] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const store = useAppStore();
  const respond = async (response: InteractionResponse): Promise<void> => {
    setPending(true);
    setSubmitError(null);
    try {
      const accepted = await props.respond(props.interaction.id, response);
      store.registerCommand(accepted.commandId, {
        surface: "interaction",
        control: "respond",
        sessionId: props.interaction.sessionId,
        resourceId: props.interaction.id,
      });
    } catch {
      setSubmitError(copy.interaction.responseFailed);
    } finally {
      setPending(false);
    }
  };
  const interaction = props.interaction;
  const failureNotice = (
    <>
      {submitError === null ? null : (
        <p className="form-error" role="alert">{submitError}</p>
      )}
      <CommandFailureNotice owner={{
        surface: "interaction",
        control: "respond",
        sessionId: interaction.sessionId,
        resourceId: interaction.id,
      }} />
    </>
  );

  if (interaction.kind === "tool-approval") {
    const indexes = interaction.permissionSuggestions.map((item) => item.index);
    return (
      <article className="interaction-card approval" aria-label={`${interaction.toolName} ${copy.interaction.approval}`}>
        <header><span>{copy.interaction.approval}</span><strong>{interaction.toolName}</strong>{props.onSelect === undefined ? null : <button type="button" className="text-button" onClick={() => props.onSelect?.(interaction.id)}>{copy.interaction.viewApprovalDetails}</button>}</header>
        {failureNotice}
        <p>{copy.interaction.approvalBody}</p>
        <div className="interaction-actions">
          <button disabled={pending} className="button primary" type="button" onClick={() => void respond({ kind: "allow", suggestionIndexes: [] })}>{copy.interaction.allowOnce}</button>
          {indexes.length === 0 ? null : <button disabled={pending} className="button ghost" type="button" onClick={() => void respond({ kind: "allow", suggestionIndexes: indexes })}>{copy.interaction.allowRemember}</button>}
          <button disabled={pending} className="button danger" type="button" onClick={() => void respond({ kind: "deny", message: denial, interrupt })}>{copy.interaction.deny}</button>
        </div>
        <label className="compact-field">{copy.interaction.denialReason}<input value={denial} onChange={(event) => setDenial(event.currentTarget.value)} /></label>
        <label className="check-field"><input type="checkbox" checked={interrupt} onChange={(event) => setInterrupt(event.currentTarget.checked)} />{copy.interaction.interruptTurn}</label>
      </article>
    );
  }

  if (interaction.kind === "question") {
    return (
      <article className="interaction-card question" aria-label={copy.interaction.agentQuestion}>
        <header><span>{copy.interaction.agentQuestion}</span></header>
        {failureNotice}
        {interaction.questions.map((question) => (
          <fieldset key={question.question}>
            <legend>{question.question}</legend>
            {question.options.map((option) => (
              <label key={option.label} className="check-field">
                <input
                  type={question.multiSelect ? "checkbox" : "radio"}
                  name={question.question}
                  value={option.label}
                  onChange={(event) => {
                    const previous = answers[question.question]?.split(", ").filter(Boolean) ?? [];
                    const value = question.multiSelect
                      ? event.currentTarget.checked
                        ? [...previous, option.label]
                        : previous.filter((entry) => entry !== option.label)
                      : [option.label];
                    setAnswers({ ...answers, [question.question]: value.join(", ") });
                  }}
                />
                {option.label}
              </label>
            ))}
            <input aria-label={`${question.header} ${copy.interaction.customAnswer}`} placeholder={copy.interaction.customAnswer} onChange={(event) => setAnswers({ ...answers, [question.question]: event.currentTarget.value })} />
          </fieldset>
        ))}
        <button disabled={pending} className="button primary" type="button" onClick={() => void respond({ kind: "answer", answers })}>{copy.interaction.submitAnswers}</button>
      </article>
    );
  }

  const isUrl = interaction.mode === "url" && interaction.url !== undefined;
  return (
    <article className="interaction-card mcp" aria-label={`${interaction.serverName} MCP 请求`}>
      <header><span>{copy.interaction.mcpElicitation}</span><strong>{interaction.serverName}</strong></header>
      {failureNotice}
      {interaction.prompt === undefined ? null : <p>{interaction.prompt}</p>}
      {isUrl ? <a href={interaction.url} target="_blank" rel="noreferrer">{copy.interaction.openRequestedPage}</a> : null}
      <div className="interaction-actions">
        {isUrl ? (
          <button disabled={pending} className="button primary" type="button" onClick={() => void respond({ kind: "elicit", action: "accept", content: {} })}>{copy.interaction.accept}</button>
        ) : (
          <McpForm
            schema={interaction.requestedSchema}
            disabled={pending}
            onAccept={(content) => void respond({ kind: "elicit", action: "accept", content })}
          />
        )}
        <button disabled={pending} className="button ghost" type="button" onClick={() => void respond({ kind: "elicit", action: "decline" })}>{copy.interaction.decline}</button>
        <button disabled={pending} className="button ghost" type="button" onClick={() => void respond({ kind: "elicit", action: "cancel" })}>{copy.common.cancel}</button>
      </div>
    </article>
  );
}
