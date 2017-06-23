'use strict';

const chai = require('chai');
const expect = chai.expect;

const { dateToDayOfYear } = require('../app/reingest.js');


/**
 * Checks every date in the year given to make sure that the dateToDayOfYear function returns the
 * correct data.
 */
const checkEveryDateInYear = (year, isLeap) => {
  const numDays = isLeap ? 366 : 365;

  for (let day = 1; day <= numDays; day += 1) {
    const daysSinceJanFirst = day - 1;
    const msSinceJanFirst = daysSinceJanFirst * 24 * 3600 * 1000;
    const yearMs = Date.UTC(year, 0);
    let d = new Date(yearMs + msSinceJanFirst);
    let dayOfYear = dateToDayOfYear(d);

    if (dayOfYear !== day) {
      throw new Error(`${dayOfYear} is not ${day} for year ${year}`);
    }

    // Try a time later on that same day
    d = new Date(yearMs + msSinceJanFirst + (14 * 3600 * 1000));
    dayOfYear = dateToDayOfYear(d);

    if (dayOfYear !== day) {
      throw new Error(`${dayOfYear} is not ${day} at a later time in day in year ${year}`);
    }
  }
};

const spotcheckDate = (dateStr, expectedDay) => {
  const d = new Date(Date.parse(dateStr));
  expect(dateToDayOfYear(d)).to.eql(expectedDay);
};


// Spotcheck dates from here
// https://www.esrl.noaa.gov/gmd/grad/neubrew/Calendar.jsp?view=DOY&year=2017&col=4
describe('dateToDayOfYear', () => {
  it('should be valid for every day in leap years', () => {
    checkEveryDateInYear(2016, true);
    spotcheckDate('2016-01-01T00:00:00Z', 1);
    spotcheckDate('2016-02-29T00:00:00Z', 60);
    spotcheckDate('2016-06-22T13:00:00Z', 174);
    spotcheckDate('2016-12-31T23:59:59.999Z', 366);
  });

  it('should be valid for every day in a non-leap year', () => {
    checkEveryDateInYear(2017, false);

    spotcheckDate('2017-01-01T00:00:00Z', 1);
    spotcheckDate('2017-01-01T23:59:59.999Z', 1);
    spotcheckDate('2017-02-28T00:00:00Z', 59);
    spotcheckDate('2017-06-22T13:00:00Z', 173);
    spotcheckDate('2017-12-31T23:59:59.999Z', 365);
  });
});
