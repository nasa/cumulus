'use strict';

const Manager = require('./base');
const Provider = require('./providers');
const collectionSchema = require('../schemas').collection;
const ValidationError = require('../errors').ValidationError;

class Collection extends Manager {
  static recordIsValid(_item, schema = null) {
    const item = _item;
    super.recordIsValid(item, schema, 'all');

    // make sure inputFiles and outputFiles of processStep
    // match the keys in files
    const recipeFiles = [
      item.recipe.processStep.config.inputFiles,
      item.recipe.processStep.config.outputFiles
    ];
    const fileKeys = Object.keys(item.granuleDefinition.files);

    recipeFiles.forEach((rf) => {
      const test = rf.map(x => fileKeys.includes(x)).every(x => x);
      if (!test) throw new ValidationError('inputFiles don\'t match files keys');
    });

    // make sure order items matches recipe keys
    //const recipeKeys = Object.keys(item.recipe);
    //let test = item.recipe.order.map(x => recipeKeys.includes(x)).every(x => x);
    //if (!test) throw new ValidationError('recipe order items don\'t match recipe keys');
    // // for now we just hard code the order
    item.recipe.order = ['processStep', 'archive', 'cmr'];

    // test granuleId extraction and validation regex
    const extraction = new RegExp(item.granuleDefinition.granuleIdExtraction);
    const match = item.granuleDefinition.sampleFileName.match(extraction);

    if (!match) {
      throw new ValidationError(
        'granuleIdExtraction regex returns null when applied to sampleFileName'
      );
    }

    let validation = new RegExp(item.granuleDefinition.granuleId);
    let test = validation.test(match[1]);

    if (!test) {
      throw new ValidationError('granuleId regex cannot validate output of granuleIdExtraction');
    }

    // test if neededForProcessing matches files keys
    test = item.granuleDefinition.neededForProcessing.map(x => fileKeys.includes(x)).every(x => x);

    if (!test) {
      throw new ValidationError('neededForProcessing items don\'t match files keys');
    }

    // make sure regex rules for files are correct
    fileKeys.forEach((key) => {
      validation = new RegExp(item.granuleDefinition.files[key].regex);
      test = validation.test(item.granuleDefinition.files[key].sampleFileName);
      if (!test) throw new ValidationError(`Regex rule for file ${key} is invalid`);
    });
  }

  constructor() {
    super(process.env.CollectionsTable, collectionSchema);
  }

  async create(_items) {
    let items = _items;
    items = await super.create(items);

    async function addRegex(item) {
      if (item.providers) {
        const p = new Provider();
        for (const provider of item.providers) {
          try {
            // if the update didn't happen gracefully ignore
            await p.addRegex(
              provider,
              item.granuleDefinition.granuleIdExtraction,
              item.collectionName
            );
          }
          catch (e) {
            console.error(e);
          }
        }
      }
    }

    // add file definitions to the
    if (items instanceof Array) {
      for (const item of items) {
        await addRegex(item);
      }
      return items;
    }

    await addRegex(items);
    return items;
  }


  async delete(item) {
    const collection = await this.get({ collectionName: item.collectionName });
    const response = await super.delete(item);

    // remove the collectionName from the provider table
    const p = new Provider();
    if (collection.providers) {
      for (const provider of collection.providers) {
        try {
          await p.removeRegex(provider, item.collectionName);
        }
        catch (e) {
          console.error(e);
        }
      }
    }
    return response;
  }
}

module.exports = Collection;
