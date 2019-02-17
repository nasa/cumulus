# @cumulus/common/util

A collection of small utility functions

## Usage
```js
const { isNil } = require('@cumulus/common/util');

if (isNil(someVar)) console.log('someVar is null or undefined');
```

## API

### `negate(predicate)`

Creates a function that returns the opposite of the predicate function.

#### Arguments

- **`predicate (Function)`**: the predicate to negate

#### Returns

- **`(Function)`**: the new negated function

#### Example

```js
const isEven = (n) => n % 2 === 0;
const isOdd = negate(isEven);
isEven(2); // => true
isOdd(2); // => false
```
