# MarketplaceListing


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** |  | [optional] 
**agent_id** | **UUID** |  | [optional] 
**trainer_id** | **UUID** |  | [optional] 
**title** | **str** |  | [optional] 
**description** | **str** |  | [optional] 
**price_type** | **str** |  | [optional] 
**price_amount** | **float** |  | [optional] 
**commission_rate** | **float** | Commission percentage (0-100) | [optional] 
**status** | **str** |  | [optional] 
**avg_rating** | **float** |  | [optional] 
**total_acquisitions** | **int** |  | [optional] 
**created_at** | **datetime** |  | [optional] 

## Example

```python
from agentanchor.models.marketplace_listing import MarketplaceListing

# TODO update the JSON string below
json = "{}"
# create an instance of MarketplaceListing from a JSON string
marketplace_listing_instance = MarketplaceListing.from_json(json)
# print the JSON string representation of the object
print(MarketplaceListing.to_json())

# convert the object into a dict
marketplace_listing_dict = marketplace_listing_instance.to_dict()
# create an instance of MarketplaceListing from a dict
marketplace_listing_from_dict = MarketplaceListing.from_dict(marketplace_listing_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


