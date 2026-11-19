export const BHW_STRINGS = {
  errors: {
    houseNoEmpty: "Enter the house number.",
    purokEmpty: "Choose the purok.",
    mathMismatch: (type, loc, withCover, without, total) => `${type} (${loc}): ${withCover} + ${without} is not ${total}. With cover plus without cover must equal the total.`,
    positiveExceeds: (type, loc) => `${type} (${loc}): positive containers cannot be more than the total.`,
    noRowsOrChecked: "Add at least one container row, or tick No containers found.",
    rowsAndChecked: "Remove the container rows or untick No containers found.",
    surveyedByEmpty: "Choose who did the interview from the list.",
    dateFuture: "The date cannot be after today.",
    dateTooOld: "This date is more than 14 days ago, so it can no longer count. Check the date.",
    storageFailed: "This phone cannot save drafts."
  },
  status: {
    notStarted: "Not started",
    inProgress: "In progress",
    completed: "Completed",
    expired: "Expired",
    invalidLink: "This link is not valid. Ask the health office for a new one."
  },
  containers: {
    indoor: ["Jar", "Jug/pitcher", "Drum", "Tin can", "Flower vase", "Bottle", "Ant trap", "Dish Drain Board", "Others"],
    outdoor: ["Jar", "Jug/pitcher", "Drum", "Tin can", "Flower vase", "Bottle", "Tire", "Ant trap", "Others"],
    natural: ["Plant axils", "Tree holes", "Ground/rock holes", "Coco shells", "Bamboo stumps", "Others"]
  }
};