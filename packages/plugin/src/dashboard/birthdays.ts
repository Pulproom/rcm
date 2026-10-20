import { type EntityBirthday } from "@rcm/shared";

export { birthdayPeople, type BirthdayPerson } from "@rcm/shared";
import type { BirthdayPerson } from "@rcm/shared";

/** Receives the same parsed scene date as holidays; never reads the real clock or prose. */
export function birthdaysForStoryDate(date: { month?: number; day?: number } | null | undefined, people: readonly BirthdayPerson[]): BirthdayPerson[] {
  return people.filter(person => person.birthday.month === date?.month && person.birthday.day === date?.day);
}

export const birthdayLabel = (birthday: EntityBirthday): string =>
  `${birthday.year === undefined ? "" : `${birthday.year}년 `}${birthday.month}월 ${birthday.day}일`;
