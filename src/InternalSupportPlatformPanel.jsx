import { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

const INTERNAL_SUPPORT_ISSUE_OPTIONS = [
  "Internet",
  "Power Cut",
  "Water Issue",
  "Machinery",
  "Food",
  "Issue with Asset",
  "Lift not working",
  "Issue with Biometric",
  "Floor Hygeine",
  "Lost Personnal Belongings"
];

const INTERNAL_SUPPORT_FLOOR_OPTIONS = [
  "Ground Floor",
  "1st Floor",
  "2nd Floor",
  "3rd Floor",
  "4th Floor",
  "5th Floor"
];

const INTERNAL_SUPPORT_FLOOR_OPTIONAL_ISSUES = [
  "Food",
  "Issue with Asset",
  "Issue with Biometric",
  "Lost Personnal Belongings"
];

function internalSupportNeedsFloor(selectedIssues) {
  return selectedIssues.some(
    (issue) => !INTERNAL_SUPPORT_FLOOR_OPTIONAL_ISSUES.includes(issue)
  );
}

/** Tools → Internal Support Platform. Multi-select issues + comment; ticket save comes later. */
export default function InternalSupportPlatformPanel() {
  const [selectedIssues, setSelectedIssues] = useState([]);
  const [selectedFloor, setSelectedFloor] = useState("");
  const [comment, setComment] = useState("");
  const [issueInvalid, setIssueInvalid] = useState(false);
  const [floorInvalid, setFloorInvalid] = useState(false);
  const [commentInvalid, setCommentInvalid] = useState(false);
  const [didSubmit, setDidSubmit] = useState(false);

  function toggleIssue(label) {
    const next = selectedIssues.includes(label)
      ? selectedIssues.filter((item) => item !== label)
      : [...selectedIssues, label];
    setSelectedIssues(next);
    setIssueInvalid(false);
    setDidSubmit(false);
    if (next.length === 0 || !internalSupportNeedsFloor(next)) {
      setFloorInvalid(false);
    }
    if (next.length === 0) {
      setCommentInvalid(false);
    }
  }

  function selectFloor(label) {
    setSelectedFloor((current) => (current === label ? "" : label));
    setFloorInvalid(false);
    setDidSubmit(false);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const trimmedComment = comment.trim();
    const noIssues = selectedIssues.length === 0;
    const floorRequired = internalSupportNeedsFloor(selectedIssues);
    const noFloor = floorRequired && selectedFloor.length === 0;
    const noComment = trimmedComment.length === 0;
    setIssueInvalid(noIssues);
    setFloorInvalid(noFloor);
    setCommentInvalid(noComment);
    if (noIssues || noFloor || noComment) {
      console.warn("[internal-support] submit blocked", {
        noIssues,
        noFloor,
        noComment,
        floorRequired
      });
      setDidSubmit(false);
      return;
    }
    console.info("[internal-support] submit", {
      issues: selectedIssues,
      floor: selectedFloor,
      comment: trimmedComment
    });
    setSelectedIssues([]);
    setSelectedFloor("");
    setComment("");
    setIssueInvalid(false);
    setFloorInvalid(false);
    setCommentInvalid(false);
    setDidSubmit(true);
  }

  const hasIssuePick = selectedIssues.length > 0;
  const floorRequired = internalSupportNeedsFloor(selectedIssues);
  const canShowComment =
    hasIssuePick && (!floorRequired || selectedFloor.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <LifeBuoy />
            <CardTitle>
              Facing an issue? Select the option below that best describes your problem.
            </CardTitle>
          </div>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent>
            <FieldGroup className="gap-4">
              <Field data-invalid={issueInvalid || undefined}>
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label="Issue types"
                >
                  {INTERNAL_SUPPORT_ISSUE_OPTIONS.map((label) => {
                    const isSelected = selectedIssues.includes(label);
                    return (
                      <Button
                        key={label}
                        type="button"
                        variant={isSelected ? "default" : "outline"}
                        aria-pressed={isSelected}
                        onClick={() => toggleIssue(label)}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
                {issueInvalid ? (
                  <FieldError>Pick at least one issue.</FieldError>
                ) : null}
              </Field>
              {floorRequired ? (
                <FieldSet className="gap-3">
                  <FieldLegend>Select your Floor</FieldLegend>
                  <Field data-invalid={floorInvalid || undefined}>
                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-label="Floor"
                    >
                      {INTERNAL_SUPPORT_FLOOR_OPTIONS.map((label) => {
                        const isSelected = selectedFloor === label;
                        return (
                          <Button
                            key={label}
                            type="button"
                            variant={isSelected ? "default" : "outline"}
                            aria-pressed={isSelected}
                            onClick={() => selectFloor(label)}
                          >
                            {label}
                          </Button>
                        );
                      })}
                    </div>
                    {floorInvalid ? <FieldError>Pick a floor.</FieldError> : null}
                  </Field>
                </FieldSet>
              ) : null}
              {canShowComment ? (
                <Field data-invalid={commentInvalid || undefined}>
                  <FieldLabel htmlFor="internal-support-comment">Comment</FieldLabel>
                  <Textarea
                    id="internal-support-comment"
                    name="comment"
                    rows={5}
                    placeholder="Explain the issue in detail"
                    value={comment}
                    aria-invalid={commentInvalid || undefined}
                    onChange={(event) => {
                      setComment(event.target.value);
                      setCommentInvalid(false);
                      setDidSubmit(false);
                    }}
                  />
                  {commentInvalid ? (
                    <FieldError>Write a comment that explains the issue.</FieldError>
                  ) : null}
                </Field>
              ) : null}
            </FieldGroup>
          </CardContent>
          {canShowComment || didSubmit ? (
            <CardFooter className="flex flex-col items-start gap-4">
              {canShowComment ? <Button type="submit">Submit</Button> : null}
              {didSubmit ? (
                <Alert>
                  <AlertDescription>
                    Thank you. Your issue has been submitted and the concerned team will look into it shortly.
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardFooter>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
