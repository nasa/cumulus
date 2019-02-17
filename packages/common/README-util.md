# @cumulus/common/util

A collection of small utility functions

## Usage
```js
const { isNil } = require('@cumulus/common/util');

if (isNil(someVar)) console.log('someVar is null or undefined');
```

## Function list
* [deprecate](#deprecatename-version-alternative)
* [isNil](#isnilx)
* [isNull](#isnullx)
* [isUndefined](#isundefinedx)
* [negate](#negatepredicate)
* [noop](#noop)
* [sleep](#sleepwaitperiodms)
* [omit](#omitobjectin-keys)
* [uuid](#uuid)

## API

### deprecate(name, version, [alternative])

Displays a message indicating that a piece of code is deprecated

#### Arguments

- **name (String)**: the name of the function / method / class to deprecate
- **version (String)**: the version after which the code will be marked as
  deprecated
- **alternative (String)**: the function / method / class to use instead of this
  deprecated code

#### Example

```js
deprecate(
  '@cumulus/common/util#isNil()',
  '1.2.3',
  '@cumulus/new-lib/util#isNil()'
);
```

### isNil(x)

Checks if a value is null or undefined

#### Arguments

- **x (*)**: the value to check

#### Returns

- **(boolean)**: true if the value is null or undefined, false otherwise

#### Example

```js
isNil(undefined); // => true
isNil(null); // => true
isNil('asdf'); // => false
```

### isNull(x)

Checks if a value is null

#### Arguments

- **x (\*)**: the value to check

#### Returns

- **(boolean)**: true if the value is null, false otherwise

#### Example

```js
isNull(null); // => true
isNull('asdf'); // => false
isNull(undefined); // => false
```

### isUndefined(x)

Checks if a value is undefined

#### Arguments

- **x (*)**: the value to check

#### Returns

- **(boolean)**: true if the value is undefined, false otherwise

#### Example

```js
isUndefined(undefined); // => true
isUndefined('asdf'); // => false
isUndefined(null); // => false
```

### negate(predicate)

Creates a function that returns the opposite of the predicate function.

#### Arguments

- **predicate (Function)**: the predicate to negate

#### Returns

- **(Function)**: the new negated function

#### Example

```js
const isEven = (n) => n % 2 === 0;
const isOdd = negate(isEven);
isEven(2); // => true
isOdd(2); // => false
```

### noop()

A function that does nothing and returns undefined

### sleep(waitPeriodMs)

Wait for the defined number of milliseconds

#### Arguments

- **waitPeriodMs (Integer)**: number of milliseconds to wait

#### Returns

- **(Promise\<undefined\>)**: resolves after the wait period

#### Example

```js
sleep(1000).then(() => console.log('I just slept for a second'));
```

### omit(objectIn, keys)

Replacement for lodash.omit. Returns a shallow copy of input object with keys
removed. (lodash.omit will be removed in v5.0.0)

#### Arguments

- **objectIn (Object)**: input object
- **keys (String|Array\<String\>)**: key or listof keys to remove from object

#### Returns

- **(Object)**: copy of objectIn without keys attached

#### Example

```js
omit({ a: 1, b: 2, c: 3 }, ['b', 'c']); // => { a: 1 }
```

### uuid()

Generate and return an RFC4122 v4 UUID

#### Returns

- **(String)**: an RFC44122 v4 UUID

#### Example

```js
uuid(); // => '10ba038e-48da-487b-96e8-8d3b99b6d18a'
```
