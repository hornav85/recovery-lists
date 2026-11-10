/**
 * Database sheet column map (0-based indices).
 * Status is column W = index 22.
 */
export const COL = {
  DATE: 0,
  TEAM: 1,
  NAME: 2,
  ADDRESS: 3,
  MEETING_TIME: 4,
  PROJECT: 5,
  CELL: 6,
  AGENT: 7,
  WELCOME_CALL: 8,
  CONFIRMED: 9,
  SOURCE: 10,
  LANGUAGE: 11,
  SENT: 12,
  STATUS_LOWER: 13,
  PAID: 14,
  BLANK: 15,
  NOTES: 16,
  OWNERSHIP: 17,
  NOTES_FOLLOWUPS: 18,
  RECOVERY_AGENT: 19,
  CHALLENGE: 20,
  SALES_AMOUNT: 21,
  STATUS: 22, // Column W
  MEETING_ID: 23,
  CALENDAR_EVENT_ID: 24,
  PROSPECT_ID: 25,
  LEAD_ID: 26,
  APPOINTMENT_DATE: 27,
} as const;

export type LeadRow = {
  date: string;
  team: string;
  name: string;
  address: string;
  meetingTime: string;
  project: string;
  cell: string;
  agent: string;
  welcomeCall: string;
  confirmed: string;
  source: string;
  language: string;
  sent: string;
  statusLower: string;
  paid: string;
  notes: string;
  ownership: string;
  notesFollowups: string;
  recoveryAgent: string;
  challenge: string;
  salesAmount: string;
  status: string;
  meetingId: string;
  calendarEventId: string;
  prospectId: string;
  leadId: string;
  appointmentDate: string;
  sheetRowIndex: number;
};

export function rowFromCells(cells: string[], sheetRowIndex: number): LeadRow {
  const g = (i: number) => (cells[i] ?? "").toString().trim();
  return {
    date: g(COL.DATE),
    team: g(COL.TEAM),
    name: g(COL.NAME),
    address: g(COL.ADDRESS),
    meetingTime: g(COL.MEETING_TIME),
    project: g(COL.PROJECT),
    cell: g(COL.CELL),
    agent: g(COL.AGENT),
    welcomeCall: g(COL.WELCOME_CALL),
    confirmed: g(COL.CONFIRMED),
    source: g(COL.SOURCE),
    language: g(COL.LANGUAGE),
    sent: g(COL.SENT),
    statusLower: g(COL.STATUS_LOWER),
    paid: g(COL.PAID),
    notes: g(COL.NOTES),
    ownership: g(COL.OWNERSHIP),
    notesFollowups: g(COL.NOTES_FOLLOWUPS),
    recoveryAgent: g(COL.RECOVERY_AGENT),
    challenge: g(COL.CHALLENGE),
    salesAmount: g(COL.SALES_AMOUNT),
    status: g(COL.STATUS),
    meetingId: g(COL.MEETING_ID),
    calendarEventId: g(COL.CALENDAR_EVENT_ID),
    prospectId: g(COL.PROSPECT_ID),
    leadId: g(COL.LEAD_ID),
    appointmentDate: g(COL.APPOINTMENT_DATE),
    sheetRowIndex,
  };
}
