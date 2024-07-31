import { QueryEvent } from "../types/search";
import { BaseSearch } from "./BaseSearch";

/**
 * Class to build and execute db search query for rules
 */
export class RuleSearch extends BaseSearch {
    constructor(event: QueryEvent) {
        super(event, 'rule');
    }
}