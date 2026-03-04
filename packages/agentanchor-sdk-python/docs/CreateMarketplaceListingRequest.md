# CreateMarketplaceListingRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**agent_id** | **UUID** |  | 
**title** | **str** |  | 
**description** | **str** |  | [optional] 
**price_type** | **str** |  | 
**price_amount** | **float** |  | [optional] 
**commission_rate** | **float** |  | [optional] 

## Example

```python
from agentanchor.models.create_marketplace_listing_request import CreateMarketplaceListingRequest

# TODO update the JSON string below
json = "{}"
# create an instance of CreateMarketplaceListingRequest from a JSON string
create_marketplace_listing_request_instance = CreateMarketplaceListingRequest.from_json(json)
# print the JSON string representation of the object
print(CreateMarketplaceListingRequest.to_json())

# convert the object into a dict
create_marketplace_listing_request_dict = create_marketplace_listing_request_instance.to_dict()
# create an instance of CreateMarketplaceListingRequest from a dict
create_marketplace_listing_request_from_dict = CreateMarketplaceListingRequest.from_dict(create_marketplace_listing_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


