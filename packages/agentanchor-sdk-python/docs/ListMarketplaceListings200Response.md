# ListMarketplaceListings200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**List[MarketplaceListing]**](MarketplaceListing.md) |  | [optional] 
**meta** | [**PaginationMeta**](PaginationMeta.md) |  | [optional] 

## Example

```python
from agentanchor.models.list_marketplace_listings200_response import ListMarketplaceListings200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListMarketplaceListings200Response from a JSON string
list_marketplace_listings200_response_instance = ListMarketplaceListings200Response.from_json(json)
# print the JSON string representation of the object
print(ListMarketplaceListings200Response.to_json())

# convert the object into a dict
list_marketplace_listings200_response_dict = list_marketplace_listings200_response_instance.to_dict()
# create an instance of ListMarketplaceListings200Response from a dict
list_marketplace_listings200_response_from_dict = ListMarketplaceListings200Response.from_dict(list_marketplace_listings200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


