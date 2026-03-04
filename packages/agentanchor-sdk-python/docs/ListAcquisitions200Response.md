# ListAcquisitions200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**List[Acquisition]**](Acquisition.md) |  | [optional] 

## Example

```python
from agentanchor.models.list_acquisitions200_response import ListAcquisitions200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListAcquisitions200Response from a JSON string
list_acquisitions200_response_instance = ListAcquisitions200Response.from_json(json)
# print the JSON string representation of the object
print(ListAcquisitions200Response.to_json())

# convert the object into a dict
list_acquisitions200_response_dict = list_acquisitions200_response_instance.to_dict()
# create an instance of ListAcquisitions200Response from a dict
list_acquisitions200_response_from_dict = ListAcquisitions200Response.from_dict(list_acquisitions200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


