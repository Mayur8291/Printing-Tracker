/** Temporary in-app WhatsApp Concierge flow for testing the Enquiry tab. */

export const SIM_BTN = {
  access: "menu_access",
  track: "menu_track",
  help: "menu_help",
  shopNew: "shop_new_member",
  existingCustomer: "access_existing",
  helpRegular: "help_regular",
  helpCustom: "help_custom",
  helpCustomEnquiries: "help_custom_enquiries",
  helpCustomConcerns: "help_custom_concerns",
  helpCustomDelay: "help_custom_delay",
  helpCustomProduct: "help_custom_product",
  imagesDone: "help_images_done",
  imagesMore: "help_images_more",
  enquirySkipOrder: "enquiry_skip_order",
  mainMenu: "menu_home",
  managerUnknown: "manager_unknown"
};

export function looksLikeOrderId(raw) {
  return /^[A-Z]{1,4}\d{4,12}$/i.test(String(raw ?? "").trim());
}

export function isGreeting(text) {
  return /^(hi|hello|hey|hii|menu|start|help)$/i.test(String(text ?? "").trim());
}

function homeButtons() {
  return [
    { id: SIM_BTN.access, title: "Customer Access" },
    { id: SIM_BTN.help, title: "Help with order" }
  ];
}

function afterMenu(text) {
  return { kind: "buttons", text, buttons: homeButtons() };
}

export function mainMenu(text = "Hi I'm a Scott Concierge How Can I Help you") {
  return afterMenu(text);
}

export function emptySimSession(customerName = "John Smith") {
  return {
    state: "idle",
    customerName,
    surveyEnquiryId: null,
    surveyRating: "",
    draft: {
      helpKind: null,
      orderId: "",
      issue: "",
      ownershipVerified: false,
      imageFiles: [],
      collectedName: "",
      collectedPhone: ""
    }
  };
}

export function resetSimDraft(session, customerName) {
  const next = emptySimSession(customerName || session.customerName);
  next.surveyEnquiryId = session?.surveyEnquiryId || null;
  next.surveyRating = session?.surveyRating || "";
  return next;
}

export function managerButtons(teamProfiles) {
  const people = Array.isArray(teamProfiles) ? teamProfiles : [];
  const rows = people.slice(0, 8).map((p) => ({
    id: `manager_${p.id}`,
    title: String(p.full_name || p.email || "User").trim() || "User"
  }));
  rows.push({ id: SIM_BTN.managerUnknown, title: "I don't know my Account manager" });
  return rows;
}

export function managerListMessage(teamProfiles) {
  return {
    kind: "buttons",
    text: "Who is your account manager? Pick a name, or I don't know (goes to Gargi).",
    buttons: managerButtons(teamProfiles)
  };
}
