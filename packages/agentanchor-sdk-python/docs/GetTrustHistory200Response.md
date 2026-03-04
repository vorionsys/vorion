# GetTrustHistory200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**List[TrustHistory]**](TrustHistory.md) |  | [optional] 

## Example

```python
from agentanchor.models.get_trust_history200_response import GetTrustHistory200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetTrustHistory200Response from a JSON string
get_trust_history200_response_instance = GetTrustHistory200Response.from_json(json)
# print the JSON string representation of the object
print(GetTrustHistory200Response.to_json())

# convert the object into a dict
get_trust_history200_response_dict = get_trust_history200_response_instance.to_dict()
# create an instance of GetTrustHistory200Response from a dict
get_trust_history200_response_from_dict = GetTrustHistory200Response.from_dict(get_trust_history200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


